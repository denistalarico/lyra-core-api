import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Soft delete for Planner plans.
 *
 * WHY A PLAN IS DELETED THE SAME WAY A CONTENT ITEM IS
 * ---------------------------------------------------
 * `social_content_items.plan_id` is `ON DELETE CASCADE`, and
 * `social_publications.content_item_id` is `ON DELETE RESTRICT`. A hard delete
 * of a plan therefore has exactly two outcomes, and both are wrong: if any of
 * the plan's content ever published, Postgres refuses the cascade and the
 * operator gets a foreign-key error instead of an answer; if none did, the
 * cascade silently destroys every content item, destination and creative under
 * the plan, which is a month of editorial work disappearing behind a menu item
 * labelled "Excluir".
 *
 * So a deleted plan is stamped, not removed — the same rule E6 established for
 * content items in `AddSocialContentItemLifecycle1792700000000`. The rows stay,
 * the publications keep their referent, and the plan stops being listed.
 *
 * WHY THERE IS NO `archived_at` HERE
 * ----------------------------------
 * A plan already has an editorial `status`, and `archived` is one of its
 * allowed values — archiving a plan is a status transition that the Planner has
 * supported since the core migration. Content items needed a separate
 * `archived_at` precisely because their `planning_status` is an editorial
 * vocabulary with no room for "hidden". Plans do not have that problem, so
 * adding a second way to express archived state would only create the question
 * of which one wins.
 *
 * Delete is the one that cannot be a status: `status` is operator-editable
 * through `PATCH plans/:planId`, and a removal that any manager could undo by
 * editing a dropdown is not the owner-only, audited action the delete
 * permission describes.
 *
 * WHY A PARTIAL INDEX
 * -------------------
 * Every plan read now carries `deleted_at IS NULL`, including the listing that
 * the Planner loads on entry. The index covers the live rows in the order the
 * listing asks for them, and stays small because deleted plans are excluded
 * from it.
 *
 * BACKFILL IS DELIBERATELY ABSENT
 * -------------------------------
 * The column is nullable with no default, so every existing plan is live the
 * instant this runs. Nothing was deleted before the feature existed.
 */
export class AddSocialPlanSoftDelete1793100000000 implements MigrationInterface {
  name = 'AddSocialPlanSoftDelete1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_plans"
        ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "deleted_by_id" uuid
    `);

    /**
     * `deleted_by_id` carries no foreign key, matching `created_by_id` and
     * `updated_by_id` on this same table: an audit stamp has to survive the
     * deactivation of the account that made it.
     */

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_plans_scope_live"
        ON "social_plans" ("tenant_id", "workspace_id", "period_start")
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_social_plans_scope_live"
    `);

    /**
     * Dropping the column discards the record of which plans were deleted,
     * which is unavoidable — it exists nowhere else. The plans themselves are
     * all preserved and become visible again.
     */
    await queryRunner.query(`
      ALTER TABLE "social_plans"
        DROP COLUMN IF EXISTS "deleted_by_id",
        DROP COLUMN IF EXISTS "deleted_at"
    `);
  }
}
