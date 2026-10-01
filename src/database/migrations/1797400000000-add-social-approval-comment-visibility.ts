import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AP3 — explicit audience on approval comments.
 *
 * WHY `stage` CANNOT BE THE VISIBILITY RULE
 * -----------------------------------------
 * `social_approval_comments.stage` records *which phase of the workflow the
 * comment was written in*, not *who it was written for*. The Agency comment
 * path stores `stage = request.currentStage`, so an operator leaving an
 * internal note while the request sits in `awaiting_client` produces a row with
 * `stage='client'` that was never meant for the client. Client Area goes live
 * with AP3, so filtering the client projection by `stage` would, on day one,
 * publish internal notes to the customer. CA0 §AC identified this before any
 * client could read a comment; this column closes it by construction.
 *
 * `visibility` is therefore a second, independent axis:
 *
 *   stage      = where in the workflow the comment happened  (unchanged)
 *   visibility = who is allowed to read it                    (new)
 *
 * The client projection filters on `visibility='client'` alone and never
 * consults `stage`.
 *
 * WHY THE DEFAULT AND THE BACKFILL ARE BOTH `internal`
 * ----------------------------------------------------
 * Fail-closed in both directions. The column default protects any writer that
 * has not been taught about audiences yet — an unmigrated code path produces an
 * internal comment, which leaks nothing. The backfill protects the rows that
 * already exist: every one of them was written while the Client Area was dark,
 * so no human client has ever been an intended audience, and `stage='client'`
 * on those rows means only "written during the client phase". Inferring
 * audience from `stage` during the backfill is exactly the mistake the column
 * exists to prevent, so the backfill is deliberately unconditional.
 *
 * WHY A CHECK CONSTRAINT RATHER THAN AN ENUM TYPE
 * -----------------------------------------------
 * Matches every other vocabulary in this schema (`status`, `stage`,
 * `actor_type` are all varchar + CHECK). A CHECK is alterable in one statement,
 * where a Postgres enum needs a type migration to gain or lose a value.
 *
 * WHY THE PARTIAL INDEX
 * ---------------------
 * The client detail reads exactly one slice — the client-visible comments of
 * one approval, oldest first — on every render of an approval the customer
 * opens. The index covers that access path and stays small because internal
 * comments, the overwhelming majority, are excluded from it.
 */
export class AddSocialApprovalCommentVisibility1797400000000 implements MigrationInterface {
  name = 'AddSocialApprovalCommentVisibility1797400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_approval_comments"
        ADD COLUMN IF NOT EXISTS "visibility" varchar(16) NOT NULL DEFAULT 'internal'
    `);

    // Unconditional on purpose: see the header. Audience is never inferred
    // from `stage`, and every pre-AP3 comment predates any client reader.
    await queryRunner.query(`
      UPDATE "social_approval_comments"
        SET "visibility" = 'internal'
        WHERE "visibility" IS NULL OR "visibility" NOT IN ('internal', 'client')
    `);

    await queryRunner.query(`
      ALTER TABLE "social_approval_comments"
        DROP CONSTRAINT IF EXISTS "CK_social_approval_comments_visibility"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_approval_comments"
        ADD CONSTRAINT "CK_social_approval_comments_visibility"
        CHECK ("visibility" IN ('internal', 'client'))
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_approval_comments_client_visible"
        ON "social_approval_comments" ("approval_request_id", "created_at")
        WHERE "visibility" = 'client'
    `);

    /**
     * The delivery ledger of the Client Area notification channel.
     *
     * The shared `notifications` stack resolves recipient email from
     * `workspace_users` and feeds the Agency UI, neither of which a client
     * identity participates in, so client delivery is email-only and keeps
     * its own ledger (CA0 §AD).
     *
     * The unique index IS the idempotency: a retried source event conflicts
     * per recipient and is skipped, so no one is mailed twice. No foreign key
     * on `user_id` — the platform has no `users` table, the same reason
     * `client_area_memberships` has none.
     */
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "client_area_approval_notifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "company_context_id" uuid NOT NULL,
        "approval_request_id" uuid NOT NULL,
        "source_event_id" varchar(255) NOT NULL,
        "event_type" varchar(120) NOT NULL,
        "user_id" uuid NOT NULL,
        "membership_id" uuid NOT NULL,
        "channel" varchar(16) NOT NULL DEFAULT 'email',
        "delivered_at" timestamptz,
        "skipped_reason" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_client_area_approval_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "CK_client_area_approval_notifications_channel"
          CHECK ("channel" IN ('email'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_client_area_approval_notifications_event_user"
        ON "client_area_approval_notifications" ("tenant_id", "source_event_id", "user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_client_area_approval_notifications_approval"
        ON "client_area_approval_notifications" ("tenant_id", "approval_request_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "client_area_approval_notifications"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_social_approval_comments_client_visible"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_approval_comments"
        DROP CONSTRAINT IF EXISTS "CK_social_approval_comments_visibility"
    `);
    /**
     * Dropping the column discards which comments were client-visible. That is
     * unavoidable (it is recorded nowhere else) and safe in the only direction
     * that matters: without the column the client projection has no rows to
     * select, so a rollback hides client comments rather than exposing
     * internal ones.
     */
    await queryRunner.query(`
      ALTER TABLE "social_approval_comments"
        DROP COLUMN IF EXISTS "visibility"
    `);
  }
}
