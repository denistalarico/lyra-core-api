import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AN-LF2 — the LeadFlow report archive (aba Relatórios).
 *
 * Mirrors `social_analytics_reports` as it stands after 1797200000000 (file
 * columns included): the same scope quartet, the same CHECKs and the same scope
 * index, with the FK pointing at `leadflow_analytics_dashboards`. Purely
 * additive; `down()` drops the table and the PDFs already stored stay in the
 * private bucket under `leadflow-analytics-reports/`.
 */
export class CreateLeadFlowAnalyticsReports1800900000000 implements MigrationInterface {
  name = 'CreateLeadFlowAnalyticsReports1800900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "leadflow_analytics_reports" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid,
      "company_context_id" uuid,
      "dashboard_id" uuid,
      "title" varchar(160) NOT NULL,
      "channels" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "period_since" date NOT NULL,
      "period_until" date NOT NULL,
      "page_mode" varchar(16) NOT NULL DEFAULT 'paginated',
      "file_url" text,
      "storage_key" text,
      "file_name" varchar(180),
      "created_by_id" uuid,
      "issued_by_name" varchar(160),
      "issued_timezone" varchar(80),
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_leadflow_analytics_reports_dashboard" FOREIGN KEY ("dashboard_id") REFERENCES "leadflow_analytics_dashboards" ("id") ON DELETE SET NULL,
      CONSTRAINT "CK_leadflow_analytics_reports_page_mode" CHECK ("page_mode" IN ('paginated', 'continuous')),
      CONSTRAINT "CK_leadflow_analytics_reports_period" CHECK ("period_since" <= "period_until"),
      CONSTRAINT "CK_leadflow_analytics_reports_channels" CHECK (jsonb_typeof("channels") = 'array')
    )`);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_leadflow_analytics_reports_scope" ON "leadflow_analytics_reports" ("tenant_id", "workspace_id", "agency_client_id", "company_context_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_leadflow_analytics_reports_dashboard" ON "leadflow_analytics_reports" ("dashboard_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "leadflow_analytics_reports"',
    );
  }
}
