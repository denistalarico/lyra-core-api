import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLeadflowAnalyticsDefaultView1789100000000 implements MigrationInterface {
  name = 'AddLeadflowAnalyticsDefaultView1789100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "leadflow_analytics_views"
      ADD COLUMN IF NOT EXISTS "is_default" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_analytics_views_default_scope"
      ON "leadflow_analytics_views" (
        "tenant_id", "workspace_id", "context_type",
        COALESCE("agency_client_id", '00000000-0000-0000-0000-000000000000'::uuid),
        "user_id"
      )
      WHERE "is_default" = true
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_lf_analytics_views_default_scope"',
    );
    await queryRunner.query(`
      ALTER TABLE "leadflow_analytics_views"
      DROP COLUMN IF EXISTS "is_default"
    `);
  }
}
