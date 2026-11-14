import type { MigrationInterface, QueryRunner } from 'typeorm';

const ZERO = `'00000000-0000-0000-0000-000000000000'::uuid`;

/**
 * G3 — GA4 read model (D-G5). Additive only: three new tables, nothing existing
 * is altered. Idempotent (`IF NOT EXISTS`) because specs call `up()` directly on
 * an already migrated database.
 *
 * Uniqueness is expressed over the whole scope with NULL ids coalesced to the
 * zero uuid (Postgres treats NULLs as distinct in unique indexes), the same way
 * `social_google_authorizations` does it. Writers must name the same expressions
 * in `ON CONFLICT`.
 *
 * `down` drops the tables, which discards synced GA4 history — acceptable for a
 * rollback because the sync rebuilds it from Google.
 */
export class CreateSocialGa4ReadModel1803900000000 implements MigrationInterface {
  name = 'CreateSocialGa4ReadModel1803900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_ga4_daily_metrics" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid NULL,
        "company_context_id" uuid NULL,
        "authorization_id" uuid NULL,
        "property_id" varchar(20) NOT NULL,
        "metric_date" date NOT NULL,
        "sessions" bigint NOT NULL DEFAULT 0,
        "total_users" bigint NOT NULL DEFAULT 0,
        "new_users" bigint NOT NULL DEFAULT 0,
        "engaged_sessions" bigint NOT NULL DEFAULT 0,
        "event_count" bigint NOT NULL DEFAULT 0,
        "key_events" numeric(18,6) NOT NULL DEFAULT 0,
        "page_views" bigint NOT NULL DEFAULT 0,
        "total_revenue" numeric(18,6) NOT NULL DEFAULT 0,
        "avg_session_seconds" numeric(18,6) NOT NULL DEFAULT 0,
        "is_partial" boolean NOT NULL DEFAULT false,
        "synced_at" timestamptz NOT NULL DEFAULT now(),
        "sync_run_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ga4_daily_metrics_key"
         ON "social_ga4_daily_metrics" (
           "tenant_id","workspace_id",
           COALESCE("agency_client_id", ${ZERO}),
           COALESCE("company_context_id", ${ZERO}),
           "property_id","metric_date")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_ga4_dimension_daily" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid NULL,
        "company_context_id" uuid NULL,
        "authorization_id" uuid NULL,
        "property_id" varchar(20) NOT NULL,
        "metric_date" date NOT NULL,
        "dimension" varchar(32) NOT NULL,
        "dimension_value" varchar(300) NOT NULL,
        "sessions" bigint NOT NULL DEFAULT 0,
        "engaged_sessions" bigint NOT NULL DEFAULT 0,
        "total_users" bigint NOT NULL DEFAULT 0,
        "key_events" numeric(18,6) NOT NULL DEFAULT 0,
        "total_revenue" numeric(18,6) NOT NULL DEFAULT 0,
        "is_partial" boolean NOT NULL DEFAULT false,
        "synced_at" timestamptz NOT NULL DEFAULT now(),
        "sync_run_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_social_ga4_dimension_daily_dimension"
          CHECK ("dimension" IN ('channel_group','source_medium','campaign','landing_page','device','country'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ga4_dimension_daily_key"
         ON "social_ga4_dimension_daily" (
           "tenant_id","workspace_id",
           COALESCE("agency_client_id", ${ZERO}),
           COALESCE("company_context_id", ${ZERO}),
           "property_id","metric_date","dimension","dimension_value")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_ga4_dimension_daily_read"
         ON "social_ga4_dimension_daily" ("tenant_id","workspace_id","property_id","dimension","metric_date")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_ga4_sync_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid NULL,
        "company_context_id" uuid NULL,
        "property_id" varchar(20) NOT NULL,
        "trigger" varchar(16) NOT NULL,
        "window_start" date NOT NULL,
        "window_end" date NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'processing',
        "rows_written" integer NOT NULL DEFAULT 0,
        "api_calls" integer NOT NULL DEFAULT 0,
        "error_code" varchar(64) NULL,
        "started_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_social_ga4_sync_runs_status"
          CHECK ("status" IN ('processing','succeeded','partial','failed')),
        CONSTRAINT "CK_social_ga4_sync_runs_trigger"
          CHECK ("trigger" IN ('scheduled','manual')),
        CONSTRAINT "CK_social_ga4_sync_runs_window"
          CHECK ("window_start" <= "window_end")
      )
    `);
    // One run in flight per property and window: the lock the sync takes by
    // inserting, and the reason a double click cannot run the report twice.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ga4_sync_runs_inflight"
         ON "social_ga4_sync_runs" (
           "tenant_id","workspace_id",
           COALESCE("agency_client_id", ${ZERO}),
           COALESCE("company_context_id", ${ZERO}),
           "property_id","window_start","window_end")
         WHERE "status" = 'processing'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_ga4_sync_runs_property"
         ON "social_ga4_sync_runs" ("tenant_id","workspace_id","property_id","created_at" DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "social_ga4_sync_runs"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_ga4_dimension_daily"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "social_ga4_daily_metrics"`);
  }
}
