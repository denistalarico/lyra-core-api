import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * D4 (LeadFlow Fase 1B): structural stage role + per-role config.
 *
 * `role` is the new first-class classification of a stage
 * (entry|contacted|qualification|handoff|follow_up|won|lost|custom); `role_config`
 * holds role-specific settings. Additive and backward-safe: Agency Sales keeps
 * using `type`/`is_*_stage`; these stay independent. Existing rows are backfilled
 * from the legacy flags so current pipelines get sensible roles without manual
 * reconfiguration; everything else defaults to `custom`.
 */
export class AddCrmStageRole1786700000000 implements MigrationInterface {
  name = 'AddCrmStageRole1786700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "crm_stages"
      ADD COLUMN IF NOT EXISTS "role" varchar(24) NOT NULL DEFAULT 'custom'
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_stages"
      ADD COLUMN IF NOT EXISTS "role_config" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
    // Backfill from legacy flags, only where the role is still the default.
    await queryRunner.query(`
      UPDATE "crm_stages" SET "role" = 'won'
       WHERE "is_won_stage" = true AND "role" = 'custom'
    `);
    await queryRunner.query(`
      UPDATE "crm_stages" SET "role" = 'lost'
       WHERE "is_lost_stage" = true AND "role" = 'custom'
    `);
    await queryRunner.query(`
      UPDATE "crm_stages" SET "role" = 'entry'
       WHERE "is_initial_stage" = true AND "role" = 'custom'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "crm_stages" DROP COLUMN IF EXISTS "role_config"`,
    );
    await queryRunner.query(
      `ALTER TABLE "crm_stages" DROP COLUMN IF EXISTS "role"`,
    );
  }
}
