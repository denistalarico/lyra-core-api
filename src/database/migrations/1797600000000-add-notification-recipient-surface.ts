import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * NTF-C1 — notification recipients and push subscriptions gain an explicit
 * surface.
 *
 * WHY A COLUMN AND NOT A SECOND SET OF TABLES
 * -------------------------------------------
 * The Client Area needs the same three-level model the Agency already has
 * (notification → recipient → delivery, unique at every level). CCOM0 §17
 * established that nothing in that model is Agency-specific: `user_id` is an
 * opaque uuid with no FK to `workspace_users`, push is keyed by
 * `(tenant_id, user_id)`, unread lives on the recipient row, and the client
 * identity is *already* in the same id space (AP3 resolves a client's email
 * from `user_security_settings` for the very same `user_id`). A parallel
 * `client_notifications` family would duplicate all of it and then drift.
 *
 * So the surface becomes a dimension of the recipient rather than a new table.
 *
 * WHY THE SURFACE IS EXPLICIT AND NEVER INFERRED
 * ----------------------------------------------
 * The tempting shortcut is "no `workspace_users` row ⇒ it must be a client".
 * That is an inference from the *absence* of data, so it silently reclassifies
 * a recipient whenever an operator's workspace row is missing, pending or
 * removed — turning a failed Agency lookup into a client delivery. The column
 * is written by the publisher that knows which audience it is addressing, and
 * every read filters on it. Absence of evidence never decides a surface.
 *
 * WHY THE DEFAULT IS `agency` AND THE BACKFILL IS UNCONDITIONAL
 * -------------------------------------------------------------
 * Every row that exists today was produced by the Agency pipeline: the client
 * path of AP3 never wrote here (it had a ledger of its own, and NTF-C1 §1
 * proved it never even ran). So `agency` is not a guess, it is the fact. The
 * column default means every existing *writer* and every existing notification
 * definition keeps its exact behaviour with no edit, which is what makes this
 * migration safe to deploy ahead of the code that uses it.
 *
 * No heuristic tries to reclassify historical rows as client. The AP3 ledger
 * stays the historical record of that era (§49/§52).
 *
 * WHY THE UNIQUE INDEX HAS TO CHANGE
 * ----------------------------------
 * `UNIQUE(notification_id, user_id)` assumes one person is one recipient. One
 * human can hold two *roles*: an Agency operator who is also a member of a
 * Company is the same `user_id` on both surfaces. On a notification addressed
 * to both audiences the old index would reject the second row, and the person
 * would lose whichever delivery lost the race — silently, since an upsert
 * conflict looks like idempotency. Adding the surface to the key makes the two
 * recipients legitimately distinct while keeping retries idempotent per
 * surface.
 *
 * WHY THE ENDPOINT UNIQUE ON PUSH SUBSCRIPTIONS SURVIVES UNCHANGED
 * ----------------------------------------------------------------
 * A push endpoint is issued by the browser per service-worker registration and
 * is globally unique by construction; two rows for one endpoint would mean two
 * owners of one device channel. Keeping that unique global is what forces the
 * surface of an endpoint to be *moved* rather than duplicated when the same
 * browser registers from the other surface (§58) — the collision is visible
 * instead of producing cross-surface push.
 */
export class AddNotificationRecipientSurface1797600000000 implements MigrationInterface {
  name = 'AddNotificationRecipientSurface1797600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notification_recipients"
        ADD COLUMN IF NOT EXISTS "recipient_surface" varchar(16) NOT NULL DEFAULT 'agency'
    `);

    // Unconditional: every pre-NTF-C1 recipient came from the Agency pipeline.
    await queryRunner.query(`
      UPDATE "notification_recipients"
      SET "recipient_surface" = 'agency'
      WHERE "recipient_surface" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "notification_recipients"
        DROP CONSTRAINT IF EXISTS "chk_notification_recipients_surface"
    `);
    await queryRunner.query(`
      ALTER TABLE "notification_recipients"
        ADD CONSTRAINT "chk_notification_recipients_surface"
        CHECK ("recipient_surface" IN ('agency', 'client_area'))
    `);

    /*
     * The old key cannot coexist with the new one: it would still reject the
     * second surface of the same identity, and the new index would be
     * decorative.
     *
     * The constraint is dropped *before* the index, and both forms are
     * handled, because the live schema has it as a table CONSTRAINT (TypeORM
     * created it that way) while a freshly built database can have it as a
     * bare INDEX. Postgres refuses `DROP INDEX` on an index that backs a
     * constraint — "cannot drop index ... because constraint ... requires it"
     * — so attempting the index first fails on exactly the schema that
     * matters, production's.
     */
    await queryRunner.query(`
      ALTER TABLE "notification_recipients"
        DROP CONSTRAINT IF EXISTS "uq_notification_recipients_notification_user"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_notification_recipients_notification_user"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_recipients_notification_surface_user"
        ON "notification_recipients" ("notification_id", "recipient_surface", "user_id")
    `);

    // The client feed reads "my unread, on my surface, newest first". Without
    // the surface in the index that query scans an operator's Agency rows too.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_recipients_surface_user_created"
        ON "notification_recipients" ("recipient_surface", "user_id", "created_at")
    `);

    await queryRunner.query(`
      ALTER TABLE "notification_push_subscriptions"
        ADD COLUMN IF NOT EXISTS "surface" varchar(16) NOT NULL DEFAULT 'agency'
    `);

    await queryRunner.query(`
      UPDATE "notification_push_subscriptions"
      SET "surface" = 'agency'
      WHERE "surface" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "notification_push_subscriptions"
        DROP CONSTRAINT IF EXISTS "chk_notification_push_subscriptions_surface"
    `);
    await queryRunner.query(`
      ALTER TABLE "notification_push_subscriptions"
        ADD CONSTRAINT "chk_notification_push_subscriptions_surface"
        CHECK ("surface" IN ('agency', 'client_area'))
    `);

    // §23 — the fan-out query is "subscriptions of these users on this
    // surface, in this tenant".
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_push_subscriptions_tenant_surface_user"
        ON "notification_push_subscriptions" ("tenant_id", "surface", "user_id")
    `);
  }

  /**
   * `down` restores the original shape, and the original shape cannot hold two
   * surfaces for one identity on one notification. Those rows are dropped
   * rather than merged: keeping a client recipient while erasing the column
   * that says it is a client would leave it indistinguishable from an Agency
   * recipient, which is the one state this migration exists to prevent. A
   * client notification is a pointer, not history (CCOM0 §28) — the approval
   * and the conversation it points at are untouched.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_notification_push_subscriptions_tenant_surface_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "notification_push_subscriptions"
        DROP CONSTRAINT IF EXISTS "chk_notification_push_subscriptions_surface"
    `);
    /*
     * The two cleanup deletes below are guarded on the column's existence, not
     * written as plain DML. `down` has to be runnable when `up` never ran —
     * the migration suites replay `down → up → down → up` against a database
     * whose state they do not assume — and an unguarded `DELETE ... WHERE
     * surface <> 'agency'` raises `column "surface" does not exist` there,
     * which aborts the whole transaction. Every other statement here is
     * already idempotent through `IF EXISTS`; these two needed the same
     * property, expressed the only way DML can express it.
     */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'notification_push_subscriptions'
            AND column_name = 'surface'
        ) THEN
          DELETE FROM "notification_push_subscriptions" WHERE "surface" <> 'agency';
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "notification_push_subscriptions"
        DROP COLUMN IF EXISTS "surface"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_notification_recipients_surface_user_created"
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'notification_recipients'
            AND column_name = 'recipient_surface'
        ) THEN
          DELETE FROM "notification_recipients" WHERE "recipient_surface" <> 'agency';
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_notification_recipients_notification_surface_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "notification_recipients"
        DROP CONSTRAINT IF EXISTS "chk_notification_recipients_surface"
    `);
    await queryRunner.query(`
      ALTER TABLE "notification_recipients"
        DROP COLUMN IF EXISTS "recipient_surface"
    `);
    /*
     * Restored as a table CONSTRAINT, which is the form the live schema has
     * (`pg_constraint.contype = 'u'`), not as a bare unique index. A `down`
     * that returns a *different* shape from the one it found is not a
     * rollback, and the difference would surface later as a failed
     * `DROP INDEX` exactly like the one this spec caught.
     *
     * Guarded, because `down` may run against a database where `up` never
     * did and the constraint is therefore already in place.
     */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'uq_notification_recipients_notification_user'
        ) THEN
          ALTER TABLE "notification_recipients"
            ADD CONSTRAINT "uq_notification_recipients_notification_user"
            UNIQUE ("notification_id", "user_id");
        END IF;
      END $$;
    `);
  }
}
