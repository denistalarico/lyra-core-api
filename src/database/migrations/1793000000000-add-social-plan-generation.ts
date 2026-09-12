import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets `social_copy_generation_runs` also record *plan* generation (Planner AI).
 *
 * WHY THE EXISTING TABLE AND NOT A NEW ONE
 * ----------------------------------------
 * The table already holds exactly what a plan run needs to record: the scope
 * triple, the provider/model/prompt-version provenance, the token counts and
 * `cost_cents`. §8.6 asks for AI cost per client as a SUM over that column, and
 * a second table would mean either a UNION in every cost query or a cost figure
 * that silently omits plan generation. `run_kind` already exists precisely so
 * one table can carry more than one kind of run.
 *
 * WHAT CHANGES
 * ------------
 *   1. `content_item_id` becomes nullable. A plan run creates content items, so
 *      by definition it has none when it starts. Content-copy runs are
 *      unaffected and a new CHECK keeps them required.
 *   2. `run_kind` gains `plan_grid`, the kind that builds a calendar rather than
 *      writing text.
 *   3. `requested_items` and `commemorative_date_keys` record what the operator
 *      actually asked for, so an old run stays explainable the way the copy
 *      runs' `requested_fields` does.
 *   4. `instruction` widens to 2000 characters. The plan modal's "Instruções"
 *      field is the operator's whole editorial steer for a month of content,
 *      not the short nudge a single caption rewrite takes.
 *
 * NO DATA IS REWRITTEN. Every existing row keeps its kind, its content item and
 * its recorded cost.
 */
export class AddSocialPlanGeneration1793000000000 implements MigrationInterface {
  name = 'AddSocialPlanGeneration1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        ALTER COLUMN "content_item_id" DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        DROP CONSTRAINT IF EXISTS "CK_social_copy_generation_runs_kind"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        ADD CONSTRAINT "CK_social_copy_generation_runs_kind"
        CHECK ("run_kind" IN (
          'content_copy', 'plan_copy', 'selection_copy', 'plan_grid'
        ))
    `);

    /**
     * The nullability above is allowed only for the kind that needs it. Without
     * this, a bug in the copy path could write a run with no content item and
     * nothing would notice until a proposal had nowhere to land.
     */
    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        ADD CONSTRAINT "CK_social_copy_generation_runs_content_required"
        CHECK (
          "run_kind" = 'plan_grid' OR "content_item_id" IS NOT NULL
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        ADD COLUMN IF NOT EXISTS "requested_items" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        ADD COLUMN IF NOT EXISTS "commemorative_date_keys" jsonb
    `);

    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        ADD CONSTRAINT "CK_social_copy_generation_runs_requested_items"
        CHECK ("requested_items" IS NULL OR "requested_items" > 0)
    `);

    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        ADD CONSTRAINT "CK_social_copy_generation_runs_commemorative_keys"
        CHECK (
          "commemorative_date_keys" IS NULL
          OR jsonb_typeof("commemorative_date_keys") = 'array'
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        ALTER COLUMN "instruction" TYPE varchar(2000)
    `);

    /**
     * At most one live plan-grid run per plan. The existing in-flight guard is
     * keyed on `content_item_id`, which is NULL here — and NULLs are distinct
     * in a Postgres unique index, so that guard would let a double-clicked
     * "Criar com IA" reach the provider twice.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_copy_generation_runs_plan_in_flight"
        ON "social_copy_generation_runs" ("plan_id")
        WHERE "run_kind" = 'plan_grid' AND "status" IN ('queued', 'processing')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_social_copy_generation_runs_plan_in_flight"
    `);

    /**
     * Plan runs have no content item, so they cannot survive the NOT NULL being
     * restored. They are deleted rather than back-filled with a borrowed id:
     * a run pointing at a content item it did not generate would be a false
     * provenance record, which is worse than a missing one.
     */
    await queryRunner.query(`
      DELETE FROM "social_copy_generation_runs" WHERE "run_kind" = 'plan_grid'
    `);

    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        DROP CONSTRAINT IF EXISTS "CK_social_copy_generation_runs_commemorative_keys"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        DROP CONSTRAINT IF EXISTS "CK_social_copy_generation_runs_requested_items"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        DROP COLUMN IF EXISTS "commemorative_date_keys"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        DROP COLUMN IF EXISTS "requested_items"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        DROP CONSTRAINT IF EXISTS "CK_social_copy_generation_runs_content_required"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        DROP CONSTRAINT IF EXISTS "CK_social_copy_generation_runs_kind"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        ADD CONSTRAINT "CK_social_copy_generation_runs_kind"
        CHECK ("run_kind" IN ('content_copy', 'plan_copy', 'selection_copy'))
    `);

    await queryRunner.query(`
      ALTER TABLE "social_copy_generation_runs"
        ALTER COLUMN "content_item_id" SET NOT NULL
    `);

    /**
     * `instruction` is left at varchar(2000). Narrowing it back would fail on
     * any row that used the wider limit, and a down migration that can throw on
     * real data is worse than a column that is wider than it needs to be.
     */
  }
}
