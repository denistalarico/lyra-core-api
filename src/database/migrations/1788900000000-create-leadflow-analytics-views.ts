import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLeadflowAnalyticsViews1788900000000 implements MigrationInterface {
  name = 'CreateLeadflowAnalyticsViews1788900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_analytics_views" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "context_type" varchar(30) NOT NULL,
        "agency_client_id" uuid,
        "user_id" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "schema_version" smallint NOT NULL DEFAULT 1,
        "report_type" varchar(24) NOT NULL,
        "period_from" date NOT NULL,
        "period_to" date NOT NULL,
        "channel_id" uuid,
        "business_mode" varchar(80),
        "agent_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_analytics_views" PRIMARY KEY ("id"),
        CONSTRAINT "CK_lf_analytics_views_context" CHECK (
          ("context_type" = 'agency' AND "agency_client_id" IS NULL)
          OR ("context_type" = 'client' AND "agency_client_id" IS NOT NULL)
        ),
        CONSTRAINT "CK_lf_analytics_views_schema" CHECK ("schema_version" = 1),
        CONSTRAINT "CK_lf_analytics_views_report_type" CHECK (
          "report_type" IN ('overview', 'commercial', 'messages', 'lead_score', 'automations')
        ),
        CONSTRAINT "CK_lf_analytics_views_period" CHECK ("period_from" <= "period_to")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_analytics_views_scope_user"
      ON "leadflow_analytics_views" (
        "tenant_id", "workspace_id", "context_type", "agency_client_id", "user_id"
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_analytics_views_scope_user_name"
      ON "leadflow_analytics_views" (
        "tenant_id", "workspace_id", "context_type",
        COALESCE("agency_client_id", '00000000-0000-0000-0000-000000000000'::uuid),
        "user_id", LOWER("name")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_lf_analytics_views_scope_user_name"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_lf_analytics_views_scope_user"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "leadflow_analytics_views"');
  }
}
