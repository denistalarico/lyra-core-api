import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLeadflowAnalyticsViewPreferences1789200000000 implements MigrationInterface {
  name = 'AddLeadflowAnalyticsViewPreferences1789200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "leadflow_analytics_views"
      ADD COLUMN IF NOT EXISTS "summary_types" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_analytics_views"
      ADD COLUMN IF NOT EXISTS "chart_modes" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
    await queryRunner.query(`
      UPDATE "leadflow_analytics_views"
      SET "summary_types" = CASE "report_type"
        WHEN 'messages' THEN '["service"]'::jsonb
        WHEN 'commercial' THEN '["commercial"]'::jsonb
        WHEN 'automations' THEN '["automation"]'::jsonb
        ELSE '["executive"]'::jsonb
      END
      WHERE "summary_types" = '[]'::jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "leadflow_analytics_views"
      DROP COLUMN IF EXISTS "chart_modes"
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_analytics_views"
      DROP COLUMN IF EXISTS "summary_types"
    `);
  }
}
