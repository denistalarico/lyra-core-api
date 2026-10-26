import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AN-HDR — one Visão Geral title and description per scope, shared by the
 * LeadFlow and Social Analytics (D-AN-12).
 *
 * A table of its own rather than a column on either dashboards table: the
 * header belongs to the scope, not to a product, and copying it into both rows
 * would need a sync — exactly what D-AN-16 rules out.
 *
 * The scope quartet and the partial unique pair mirror
 * `social_analytics_dashboards`: the nullable client columns make a plain
 * UNIQUE useless for the agency root (two NULLs are never equal). The CHECK
 * forbids the `legacy_unassigned` shape, which no operational request ever
 * resolves to.
 *
 * Seed: the current Social Visão Geral of each scope, then — for scopes that
 * only have LeadFlow — the LeadFlow one. Scopes with neither keep no row; the
 * service answers them with the "Visão Geral" fallback without writing.
 */
export class CreateAnalyticsOverviewHeaders1801200000000 implements MigrationInterface {
  name = 'CreateAnalyticsOverviewHeaders1801200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "analytics_overview_headers" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid,
      "company_context_id" uuid,
      "title" varchar(120) NOT NULL,
      "description" varchar(500),
      "updated_by_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_analytics_overview_headers_scope" CHECK (("agency_client_id" IS NULL) = ("company_context_id" IS NULL)),
      CONSTRAINT "CK_analytics_overview_headers_title" CHECK (length(btrim("title")) > 0)
    )`);

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_analytics_overview_headers_company"
         ON "analytics_overview_headers" ("tenant_id", "workspace_id", "agency_client_id", "company_context_id")
         WHERE "agency_client_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_analytics_overview_headers_agency"
         ON "analytics_overview_headers" ("tenant_id", "workspace_id")
         WHERE "agency_client_id" IS NULL`,
    );

    for (const source of [
      'social_analytics_dashboards',
      'leadflow_analytics_dashboards',
    ]) {
      // DISTINCT ON keeps one row per scope even if a scope ever held two
      // defaults; NOT EXISTS lets the LeadFlow pass fill only what Social left.
      await queryRunner.query(
        `INSERT INTO "analytics_overview_headers"
           ("tenant_id", "workspace_id", "agency_client_id", "company_context_id", "title", "description", "created_at", "updated_at")
         SELECT DISTINCT ON (d."tenant_id", d."workspace_id", d."agency_client_id", d."company_context_id")
                d."tenant_id", d."workspace_id", d."agency_client_id", d."company_context_id",
                left(btrim(d."name"), 120),
                NULLIF(left(btrim(COALESCE(d."description", '')), 500), ''),
                now(), now()
           FROM "${source}" d
          WHERE d."is_default"
            AND (d."agency_client_id" IS NULL) = (d."company_context_id" IS NULL)
            AND length(btrim(d."name")) > 0
            AND NOT EXISTS (
              SELECT 1 FROM "analytics_overview_headers" h
               WHERE h."tenant_id" = d."tenant_id"
                 AND h."workspace_id" = d."workspace_id"
                 AND h."agency_client_id" IS NOT DISTINCT FROM d."agency_client_id"
                 AND h."company_context_id" IS NOT DISTINCT FROM d."company_context_id"
            )
          ORDER BY d."tenant_id", d."workspace_id", d."agency_client_id", d."company_context_id", d."created_at"`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "analytics_overview_headers"',
    );
  }
}
