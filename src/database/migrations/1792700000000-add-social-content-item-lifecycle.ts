import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Archive and soft delete for Planner content items (Planner E6).
 *
 * WHY TWO COLUMNS AND NOT ONE, AND WHY NEITHER IS A STATUS
 * -------------------------------------------------------
 * `planning_status` is an editorial vocabulary — where a piece stands between
 * `idea` and `ready`. Archiving and deleting say nothing about editorial
 * progress; they say whether the row should appear at all. Folding them into
 * that column would destroy the editorial state on archive and make
 * "restore to what it was" unanswerable, which is why E6 asks for a separate
 * `archivedAt` in the first place.
 *
 * Archive and delete are then kept apart from each other because they are
 * reversible in different ways and answer to different permissions. Archive is
 * an ordinary editorial tidy-up: any manager may do it and undo it. Delete is
 * governed by `social.planner.calendar.delete.owner_or_admin_explicit` and,
 * although it is a soft delete here, it is presented to operators as removal.
 * A single nullable timestamp could not tell an archived item from a deleted
 * one, so a restore would have to guess which of the two it was undoing.
 *
 * WHY SOFT DELETE AT ALL
 * ----------------------
 * `social_publications.content_item_id` is `ON DELETE RESTRICT` and publication
 * rows are immutable execution evidence. A hard delete of a content item that
 * ever published would therefore either fail at the database or, if the FK were
 * relaxed, orphan the evidence of a post that really exists on a provider.
 * Soft delete removes the item from the Planner without touching that record,
 * which is exactly the E6 rule "não existe hard delete de evidência de
 * publicação".
 *
 * WHY PARTIAL INDEXES
 * -------------------
 * Every Planner list query now carries `deleted_at IS NULL`, and the default
 * list also carries `archived_at IS NULL`. A partial index on the live rows
 * keeps those reads on the same cost they had before this migration, and it
 * stays small because it indexes only what is visible. The full-set index on
 * `(plan_id, sort_order)` from the original table is left untouched: restore
 * and the archived list still need to reach hidden rows.
 *
 * BACKFILL IS DELIBERATELY ABSENT
 * -------------------------------
 * Both columns are nullable with no default, so every existing row is live and
 * unarchived the instant this runs. That is the correct reading of history:
 * nothing was ever archived or deleted before the feature existed.
 */
export class AddSocialContentItemLifecycle1792700000000 implements MigrationInterface {
  name = 'AddSocialContentItemLifecycle1792700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        ADD COLUMN IF NOT EXISTS "archived_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "archived_by_id" uuid,
        ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "deleted_by_id" uuid
    `);

    /**
     * The actor columns carry no foreign key, matching `created_by_id` and
     * `updated_by_id` on this same table: users live in a different datasource
     * concern, and an audit stamp must survive the deactivation of the account
     * that made it.
     */

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_content_items_plan_live"
        ON "social_content_items" ("plan_id", "sort_order")
        WHERE "deleted_at" IS NULL AND "archived_at" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_content_items_plan_archived"
        ON "social_content_items" ("plan_id", "archived_at")
        WHERE "deleted_at" IS NULL AND "archived_at" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_social_content_items_plan_archived"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_social_content_items_plan_live"
    `);

    /**
     * Dropping these columns discards the record of what was archived or
     * deleted, which is unavoidable: the information exists nowhere else. A
     * down migration here is a schema rollback, not an undo of operator
     * actions, and the rows themselves are all preserved and become visible
     * again.
     */
    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        DROP COLUMN IF EXISTS "deleted_by_id",
        DROP COLUMN IF EXISTS "deleted_at",
        DROP COLUMN IF EXISTS "archived_by_id",
        DROP COLUMN IF EXISTS "archived_at"
    `);
  }
}
