import type { MigrationInterface, QueryRunner } from 'typeorm';

const ZERO_UUID = `'00000000-0000-0000-0000-000000000000'::uuid`;
const DASHBOARD_TABLES = [
  'social_analytics_dashboards',
  'leadflow_analytics_dashboards',
] as const;

/**
 * CA-AN1 — the Client Area Analytics over the LeadFlow/Social pages.
 *
 * 1. `client_area_company_settings.analytics_overview_first` (D-AN-9): which
 *    product's Visão Geral comes first in the unified one. Additive, with a
 *    default, so existing rows read `leadflow`.
 * 2. `client_area_owner_user_id` on both dashboards tables (D-AN-14): a Client
 *    Area Owner's private dashboard. The CHECK keeps such a row a plain
 *    company dashboard — never the Visão Geral, never a channel screen, never
 *    an agency-root row — so the default/channel unique indexes stay as they
 *    are.
 * 3. The two company **name** indexes gain the owner, so an Owner may name a
 *    private dashboard like a shared one (or another Owner's). The agency-root
 *    Social index is untouched: an owned row always has a company.
 *
 * Idempotent (`IF [NOT] EXISTS`): the PostgreSQL spec runs `up` over an
 * already migrated schema. `down()` deletes the private rows first — the old
 * indexes could not hold two of them with one name — then restores the old
 * shape.
 */
export class AddClientAreaAnalyticsAccess1801300000000 implements MigrationInterface {
  name = 'AddClientAreaAnalyticsAccess1801300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_area_company_settings"
         ADD COLUMN IF NOT EXISTS "analytics_overview_first" varchar(16) NOT NULL DEFAULT 'leadflow'`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_area_company_settings"
         DROP CONSTRAINT IF EXISTS "CK_client_area_company_settings_analytics_overview_first"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_area_company_settings"
         ADD CONSTRAINT "CK_client_area_company_settings_analytics_overview_first"
         CHECK ("analytics_overview_first" IN ('leadflow', 'social'))`,
    );

    for (const table of DASHBOARD_TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "client_area_owner_user_id" uuid`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "CK_${table}_client_area_owner"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "CK_${table}_client_area_owner"
           CHECK ("client_area_owner_user_id" IS NULL OR ("agency_client_id" IS NOT NULL AND "is_default" = false AND "channel_key" IS NULL))`,
      );
    }

    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_social_analytics_dashboards_name_company"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_social_analytics_dashboards_name_company"
         ON "social_analytics_dashboards" ("tenant_id", "workspace_id", "agency_client_id", "company_context_id",
           COALESCE("client_area_owner_user_id", ${ZERO_UUID}), lower(btrim("name")))
         WHERE "agency_client_id" IS NOT NULL AND "company_context_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_leadflow_dashboards_name"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_leadflow_dashboards_name"
         ON "leadflow_analytics_dashboards" ("tenant_id", "workspace_id",
           COALESCE("agency_client_id", ${ZERO_UUID}), COALESCE("company_context_id", ${ZERO_UUID}),
           COALESCE("client_area_owner_user_id", ${ZERO_UUID}), lower(btrim("name")))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of DASHBOARD_TABLES)
      await queryRunner.query(
        `DO $$ BEGIN
           IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = current_schema() AND table_name = '${table}'
                         AND column_name = 'client_area_owner_user_id') THEN
             DELETE FROM "${table}" WHERE "client_area_owner_user_id" IS NOT NULL;
           END IF;
         END $$`,
      );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_social_analytics_dashboards_name_company"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_social_analytics_dashboards_name_company"
         ON "social_analytics_dashboards" ("tenant_id", "workspace_id", "agency_client_id", "company_context_id", lower(btrim("name")))
         WHERE "agency_client_id" IS NOT NULL AND "company_context_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_leadflow_dashboards_name"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_leadflow_dashboards_name"
         ON "leadflow_analytics_dashboards" ("tenant_id", "workspace_id",
           COALESCE("agency_client_id", ${ZERO_UUID}), COALESCE("company_context_id", ${ZERO_UUID}),
           lower(btrim("name")))`,
    );

    for (const table of DASHBOARD_TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "CK_${table}_client_area_owner"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "client_area_owner_user_id"`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "client_area_company_settings"
         DROP CONSTRAINT IF EXISTS "CK_client_area_company_settings_analytics_overview_first"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_area_company_settings" DROP COLUMN IF EXISTS "analytics_overview_first"`,
    );
  }
}
