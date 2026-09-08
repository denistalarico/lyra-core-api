import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Provider-neutral daily facts and durable sync log for organic analytics. */
export class CreateSocialOrganicReadModel1791900000000 implements MigrationInterface {
  name = 'CreateSocialOrganicReadModel1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_organic_sync_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "asset_id" uuid NOT NULL,
        "provider" varchar(40) NOT NULL,
        "run_kind" varchar(40) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'queued',
        "window_start" date,
        "window_end" date,
        "idempotency_key" varchar(200) NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 5,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "locked_at" timestamptz,
        "locked_by" varchar(120),
        "started_at" timestamptz,
        "finished_at" timestamptz,
        "rows_written" integer NOT NULL DEFAULT 0,
        "rows_skipped" integer NOT NULL DEFAULT 0,
        "api_calls" integer NOT NULL DEFAULT 0,
        "last_error" varchar(240),
        "failed_segments" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "cursor_state" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "retain_until" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_social_organic_sync_runs_status"
          CHECK ("status" IN (
            'queued', 'processing', 'succeeded',
            'partial', 'failed', 'dead_letter', 'cancelled'
          )),
        CONSTRAINT "CK_social_organic_sync_runs_window"
          CHECK (
            "window_start" IS NULL
            OR "window_end" IS NULL
            OR "window_start" <= "window_end"
          ),
        CONSTRAINT "FK_social_organic_sync_runs_asset"
          FOREIGN KEY ("asset_id")
          REFERENCES "social_organic_assets" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_organic_sync_runs_inflight"
        ON "social_organic_sync_runs" ("asset_id", "idempotency_key")
        WHERE "status" IN ('queued', 'processing')
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_sync_runs_scope"
        ON "social_organic_sync_runs"
        ("tenant_id", "workspace_id", "agency_client_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_sync_runs_queue"
        ON "social_organic_sync_runs" ("available_at")
        WHERE "status" = 'queued'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_sync_runs_stale_lock"
        ON "social_organic_sync_runs" ("locked_at")
        WHERE "status" = 'processing'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_sync_runs_asset"
        ON "social_organic_sync_runs" ("asset_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_organic_post_metrics_daily" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "asset_id" uuid NOT NULL,
        "provider" varchar(40) NOT NULL,
        "source" varchar(24) NOT NULL DEFAULT 'organic',
        "external_publication_id" varchar(180) NOT NULL,
        "publication_id" uuid,
        "metric_date" date NOT NULL,
        -- Required per fact. A missing asset timezone must never become UTC.
        "asset_timezone" varchar(64) NOT NULL,
        "impressions" bigint NOT NULL DEFAULT 0,
        -- Reach is de-duplicated audience. Never sum it across days.
        "reach" bigint NOT NULL DEFAULT 0,
        "likes" bigint NOT NULL DEFAULT 0,
        "comments" bigint NOT NULL DEFAULT 0,
        "shares" bigint NOT NULL DEFAULT 0,
        "saves" bigint NOT NULL DEFAULT 0,
        "video_views" bigint NOT NULL DEFAULT 0,
        "watch_time_seconds" bigint NOT NULL DEFAULT 0,
        "link_clicks" bigint NOT NULL DEFAULT 0,
        "profile_visits" bigint NOT NULL DEFAULT 0,
        "is_partial" boolean NOT NULL DEFAULT false,
        "synced_at" timestamptz NOT NULL DEFAULT now(),
        "sync_run_id" uuid,
        "provider_metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_social_organic_post_metrics_daily_non_negative"
          CHECK (
            "impressions" >= 0
            AND "reach" >= 0
            AND "likes" >= 0
            AND "comments" >= 0
            AND "shares" >= 0
            AND "saves" >= 0
            AND "video_views" >= 0
            AND "watch_time_seconds" >= 0
            AND "link_clicks" >= 0
            AND "profile_visits" >= 0
          ),
        CONSTRAINT "FK_social_organic_post_metrics_daily_asset"
          FOREIGN KEY ("asset_id")
          REFERENCES "social_organic_assets" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_social_organic_post_metrics_daily_sync_run"
          FOREIGN KEY ("sync_run_id")
          REFERENCES "social_organic_sync_runs" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_organic_post_metrics_daily_fact"
        ON "social_organic_post_metrics_daily"
        ("asset_id", "external_publication_id", "metric_date", "source")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_post_metrics_daily_scope"
        ON "social_organic_post_metrics_daily"
        ("tenant_id", "workspace_id", "agency_client_id", "metric_date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_post_metrics_daily_partial"
        ON "social_organic_post_metrics_daily" ("asset_id", "metric_date")
        WHERE "is_partial"
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_organic_account_metrics_daily" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "asset_id" uuid NOT NULL,
        "provider" varchar(40) NOT NULL,
        "source" varchar(24) NOT NULL DEFAULT 'organic',
        "metric_date" date NOT NULL,
        -- Required per fact. A missing asset timezone must never become UTC.
        "asset_timezone" varchar(64) NOT NULL,
        -- STOCK at end of day. NEVER SUM across dates.
        "followers_count" bigint NOT NULL DEFAULT 0,
        -- The gained/lost columns are daily flows and may be summed.
        "followers_gained" bigint NOT NULL DEFAULT 0,
        "followers_lost" bigint NOT NULL DEFAULT 0,
        "impressions" bigint NOT NULL DEFAULT 0,
        -- Reach is de-duplicated audience. Never sum it across days.
        "reach" bigint NOT NULL DEFAULT 0,
        "profile_views" bigint NOT NULL DEFAULT 0,
        "is_partial" boolean NOT NULL DEFAULT false,
        "synced_at" timestamptz NOT NULL DEFAULT now(),
        "sync_run_id" uuid,
        "provider_metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_social_organic_account_metrics_daily_non_negative"
          CHECK (
            "followers_count" >= 0
            AND "followers_gained" >= 0
            AND "followers_lost" >= 0
            AND "impressions" >= 0
            AND "reach" >= 0
            AND "profile_views" >= 0
          ),
        CONSTRAINT "FK_social_organic_account_metrics_daily_asset"
          FOREIGN KEY ("asset_id")
          REFERENCES "social_organic_assets" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_social_organic_account_metrics_daily_sync_run"
          FOREIGN KEY ("sync_run_id")
          REFERENCES "social_organic_sync_runs" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_organic_account_metrics_daily_fact"
        ON "social_organic_account_metrics_daily"
        ("asset_id", "metric_date", "source")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_account_metrics_daily_scope"
        ON "social_organic_account_metrics_daily"
        ("tenant_id", "workspace_id", "agency_client_id", "metric_date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_account_metrics_daily_partial"
        ON "social_organic_account_metrics_daily" ("asset_id", "metric_date")
        WHERE "is_partial"
    `);

    // Ratios are intentionally absent. They are derived from counters on read.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_organic_account_metrics_daily"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_organic_post_metrics_daily"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "social_organic_sync_runs"`);
  }
}
