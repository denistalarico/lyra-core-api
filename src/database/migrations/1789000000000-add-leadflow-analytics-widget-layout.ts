import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLeadflowAnalyticsWidgetLayout1789000000000 implements MigrationInterface {
  name = 'AddLeadflowAnalyticsWidgetLayout1789000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "leadflow_analytics_views"
      ADD COLUMN IF NOT EXISTS "widget_order" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_analytics_views"
      ADD COLUMN IF NOT EXISTS "hidden_widget_ids" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "leadflow_analytics_views" DROP COLUMN IF EXISTS "hidden_widget_ids"',
    );
    await queryRunner.query(
      'ALTER TABLE "leadflow_analytics_views" DROP COLUMN IF EXISTS "widget_order"',
    );
  }
}
