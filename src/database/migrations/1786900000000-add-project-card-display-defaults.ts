import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectCardDisplayDefaults1786900000000 implements MigrationInterface {
  name = 'AddProjectCardDisplayDefaults1786900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_project_settings"
      ADD COLUMN IF NOT EXISTS "project_card_display_defaults" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "agency_project_settings"
      ADD COLUMN IF NOT EXISTS "task_card_display_defaults" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_project_settings"
      DROP COLUMN IF EXISTS "task_card_display_defaults"
    `);
    await queryRunner.query(`
      ALTER TABLE "agency_project_settings"
      DROP COLUMN IF EXISTS "project_card_display_defaults"
    `);
  }
}
