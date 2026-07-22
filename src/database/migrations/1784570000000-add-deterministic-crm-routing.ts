import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeterministicCrmRouting1784570000000 implements MigrationInterface {
  name = 'AddDeterministicCrmRouting1784570000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "crm_stages"
      ADD COLUMN IF NOT EXISTS "is_initial_stage" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "inbox_channels"
      ADD COLUMN IF NOT EXISTS "default_pipeline_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "crm_pipelines"
      ADD CONSTRAINT "uq_crm_pipelines_scope_id"
      UNIQUE ("tenant_id", "workspace_id", "id")
    `);
    await queryRunner.query(`
      ALTER TABLE "inbox_channels"
      ADD CONSTRAINT "fk_inbox_channels_default_pipeline_scope"
      FOREIGN KEY ("tenant_id", "workspace_id", "default_pipeline_id")
      REFERENCES "crm_pipelines" ("tenant_id", "workspace_id", "id")
      ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE "crm_stages"
      ADD CONSTRAINT "chk_crm_stages_initial_open"
      CHECK (
        NOT "is_initial_stage"
        OR (
          "type" = 'open'
          AND NOT "is_won_stage"
          AND NOT "is_lost_stage"
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_crm_stages_single_initial"
      ON "crm_stages" ("tenant_id", "workspace_id", "pipeline_id")
      WHERE "is_initial_stage" = true AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_inbox_channels_default_pipeline"
      ON "inbox_channels" ("tenant_id", "workspace_id", "default_pipeline_id")
      WHERE "default_pipeline_id" IS NOT NULL AND "deleted_at" IS NULL
    `);

    // Existing data is backfilled only when the choice is unambiguous. Pipelines
    // with multiple eligible stages intentionally remain unconfigured and fail
    // closed until an administrator explicitly selects their initial stage.
    await queryRunner.query(`
      WITH unambiguous AS (
        SELECT "tenant_id", "workspace_id", "pipeline_id", MIN("id"::text)::uuid AS "stage_id"
        FROM "crm_stages"
        WHERE "deleted_at" IS NULL
          AND "type" = 'open'
          AND NOT "is_won_stage"
          AND NOT "is_lost_stage"
        GROUP BY "tenant_id", "workspace_id", "pipeline_id"
        HAVING COUNT(*) = 1
      )
      UPDATE "crm_stages" stage
      SET "is_initial_stage" = true
      FROM unambiguous
      WHERE stage."id" = unambiguous."stage_id"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_inbox_channels_default_pipeline"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_crm_stages_single_initial"`,
    );
    await queryRunner.query(`
      ALTER TABLE "crm_stages"
      DROP CONSTRAINT IF EXISTS "chk_crm_stages_initial_open"
    `);
    await queryRunner.query(`
      ALTER TABLE "inbox_channels"
      DROP CONSTRAINT IF EXISTS "fk_inbox_channels_default_pipeline_scope"
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_pipelines"
      DROP CONSTRAINT IF EXISTS "uq_crm_pipelines_scope_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "inbox_channels"
      DROP COLUMN IF EXISTS "default_pipeline_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_stages"
      DROP COLUMN IF EXISTS "is_initial_stage"
    `);
  }
}
