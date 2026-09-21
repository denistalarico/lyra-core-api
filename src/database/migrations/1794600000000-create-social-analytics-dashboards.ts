import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Etapa 5 — persisted Analytics dashboards and the reports emitted from them.
 *
 * The scope columns are the CC2C quartet (`tenant_id`, `workspace_id`,
 * `agency_client_id`, `company_context_id`), not the `tenant_id`/`client_id`
 * pair the sprint plan sketched: every table written since CC2C carries the
 * company context, and omitting it here would make this the one Social table a
 * company-scoped operator could not be isolated on.
 *
 * `layout` is versioned jsonb rather than columns. The card shapes are still
 * being designed (Etapas 6–8) and each new card kind would otherwise be a
 * migration; `version` inside the document is what lets a reader refuse a
 * layout it does not understand instead of misreading it.
 */
export class CreateSocialAnalyticsDashboards1794600000000 implements MigrationInterface {
  name = 'CreateSocialAnalyticsDashboards1794600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_analytics_dashboards" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid,
      "company_context_id" uuid,
      "name" varchar(120) NOT NULL,
      "is_default" boolean NOT NULL DEFAULT false,
      "channels" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "layout" jsonb NOT NULL DEFAULT '{"version":1,"sections":[]}'::jsonb,
      "created_by_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_social_analytics_dashboards_name" CHECK (length(btrim("name")) > 0),
      CONSTRAINT "CK_social_analytics_dashboards_channels" CHECK (jsonb_typeof("channels") = 'array'),
      CONSTRAINT "CK_social_analytics_dashboards_layout" CHECK (jsonb_typeof("layout") = 'object')
    )`);

    /*
     * Uniqueness is on the *normalized* name, and it is two partial indexes
     * rather than one constraint because `agency_client_id` and
     * `company_context_id` are nullable: in SQL two NULLs are never equal, so a
     * plain UNIQUE would let an agency-scoped dashboard called "Geral" be
     * created without limit. The partial pair covers both shapes explicitly.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_analytics_dashboards_name_company"
         ON "social_analytics_dashboards" ("tenant_id", "workspace_id", "agency_client_id", "company_context_id", lower(btrim("name")))
         WHERE "agency_client_id" IS NOT NULL AND "company_context_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_analytics_dashboards_name_agency"
         ON "social_analytics_dashboards" ("tenant_id", "workspace_id", lower(btrim("name")))
         WHERE "agency_client_id" IS NULL AND "company_context_id" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_analytics_dashboards_scope" ON "social_analytics_dashboards" ("tenant_id", "workspace_id", "agency_client_id", "company_context_id", "created_at")`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_analytics_reports" (
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
      "created_by_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_social_analytics_reports_dashboard" FOREIGN KEY ("dashboard_id") REFERENCES "social_analytics_dashboards" ("id") ON DELETE SET NULL,
      CONSTRAINT "CK_social_analytics_reports_page_mode" CHECK ("page_mode" IN ('paginated', 'continuous')),
      CONSTRAINT "CK_social_analytics_reports_period" CHECK ("period_since" <= "period_until"),
      CONSTRAINT "CK_social_analytics_reports_channels" CHECK (jsonb_typeof("channels") = 'array')
    )`);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_analytics_reports_scope" ON "social_analytics_reports" ("tenant_id", "workspace_id", "agency_client_id", "company_context_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_analytics_reports_dashboard" ON "social_analytics_reports" ("dashboard_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Reports first: the FK points at dashboards.
    await queryRunner.query('DROP TABLE IF EXISTS "social_analytics_reports"');
    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_analytics_dashboards"',
    );
  }
}
