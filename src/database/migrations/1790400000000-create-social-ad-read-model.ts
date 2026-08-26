import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The local read model of Lyra Social — the mirror of the ad hierarchy, the
 * daily facts, and the log of the syncs that produce both.
 *
 * Three tables in one migration because they are one design: the facts point
 * at a run, both point at a connection, and splitting them across migrations
 * would create an ordering where one exists without the constraint that gives
 * it meaning.
 *
 * Nothing reads Meta yet. No worker, no scheduler, no endpoint and no ingest
 * exists in this slice — this creates the shape that the pipeline will fill,
 * and the shape is where the irreversible decisions live: the unique key on
 * the facts is the idempotency of an ingest that has not been written, and
 * changing it later means rewriting history rather than editing a service.
 *
 * Everything here is read-only data. No table stores a credential; the token
 * stays in the connection row (or in server configuration for the internal
 * account) and is resolved through a single boundary.
 */
export class CreateSocialAdReadModel1790400000000 implements MigrationInterface {
  name = 'CreateSocialAdReadModel1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------------- entities
    //
    // One table for account, campaign, ad set and ad. The levels share every
    // scope, identity and freshness concern and differ by a handful of
    // columns; four tables would mean four upserts and a four-way union on
    // every read that renders a tree.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_ad_entities" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "connection_id" uuid NOT NULL,
        "provider" varchar(40) NOT NULL,
        "entity_level" varchar(20) NOT NULL,
        "external_id" varchar(180) NOT NULL,
        "parent_external_id" varchar(180),
        "campaign_external_id" varchar(180),
        "name" text,
        "status" varchar(40),
        "effective_status" varchar(60),
        "objective" varchar(60),
        "optimization_goal" varchar(60),
        "billing_event" varchar(60),
        "daily_budget_minor" bigint,
        "lifetime_budget_minor" bigint,
        "budget_remaining_minor" bigint,
        "currency" varchar(8),
        "start_time" timestamptz,
        "stop_time" timestamptz,
        "provider_created_time" timestamptz,
        "provider_updated_time" timestamptz,
        "first_seen_at" timestamptz NOT NULL DEFAULT now(),
        "last_seen_at" timestamptz NOT NULL DEFAULT now(),
        "archived_at" timestamptz,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "raw" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_social_ad_entities_level"
          CHECK ("entity_level" IN ('account', 'campaign', 'adset', 'ad')),
        -- An account is the root of the tree. A parent id on one means the
        -- sync mistook a campaign for its account, which silently produces a
        -- second, orphaned hierarchy. The converse is not enforced: a campaign
        -- that arrives without its account id should degrade to a rootless row
        -- rather than abort the ingest.
        CONSTRAINT "CK_social_ad_entities_account_has_no_parent"
          CHECK ("entity_level" <> 'account' OR "parent_external_id" IS NULL),
        CONSTRAINT "CK_social_ad_entities_budgets_non_negative"
          CHECK (
            ("daily_budget_minor" IS NULL OR "daily_budget_minor" >= 0)
            AND ("lifetime_budget_minor" IS NULL OR "lifetime_budget_minor" >= 0)
            AND ("budget_remaining_minor" IS NULL OR "budget_remaining_minor" >= 0)
          ),
        CONSTRAINT "FK_social_ad_entities_connection"
          FOREIGN KEY ("connection_id")
          REFERENCES "social_ad_account_connections" ("id") ON DELETE CASCADE
      )
    `);

    // The same external id under a different connection is a different object:
    // it can belong to a different Business entirely.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ad_entities_identity"
        ON "social_ad_entities"
        ("tenant_id", "workspace_id", "connection_id", "entity_level", "external_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_ad_entities_scope"
        ON "social_ad_entities"
        ("tenant_id", "workspace_id", "agency_client_id", "entity_level")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_ad_entities_parent"
        ON "social_ad_entities" ("connection_id", "parent_external_id")
    `);
    // "What did this sync not see?" — the query that archives disappeared
    // objects, which would otherwise scan the whole mirror.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_ad_entities_stale"
        ON "social_ad_entities" ("connection_id", "last_seen_at")
    `);

    // --------------------------------------------------------------- sync runs
    //
    // Created before the facts because the facts reference it. Queue and log in
    // one table: a queue that deletes its rows on completion cannot answer
    // "why is yesterday missing?", which is the only question anyone asks
    // about a sync.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_ad_sync_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "connection_id" uuid NOT NULL,
        "provider" varchar(40) NOT NULL,
        "run_kind" varchar(40) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'queued',
        "window_start" date,
        "window_end" date,
        "entity_levels" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "idempotency_key" varchar(200) NOT NULL,
        "requested_by_id" uuid,
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 5,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "locked_at" timestamptz,
        "locked_by" varchar(120),
        "started_at" timestamptz,
        "finished_at" timestamptz,
        "rows_written" integer NOT NULL DEFAULT 0,
        "rows_skipped" integer NOT NULL DEFAULT 0,
        "entities_written" integer NOT NULL DEFAULT 0,
        "api_calls" integer NOT NULL DEFAULT 0,
        "last_error" varchar(240),
        "failed_segments" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "cursor_state" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "retain_until" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        -- 'partial' earns its place: an insights window can succeed for three
        -- of four ad sets and hit a rate limit on the fourth. 'failed' throws
        -- that work away; 'succeeded' hides the hole.
        CONSTRAINT "CK_social_ad_sync_runs_status"
          CHECK ("status" IN (
            'queued', 'processing', 'succeeded',
            'partial', 'failed', 'dead_letter', 'cancelled'
          )),
        -- Tolerates NULLs on both sides: a hierarchy sync has no date window,
        -- and only an inverted pair is actually wrong.
        CONSTRAINT "CK_social_ad_sync_runs_window"
          CHECK (
            "window_start" IS NULL
            OR "window_end" IS NULL
            OR "window_start" <= "window_end"
          ),
        CONSTRAINT "FK_social_ad_sync_runs_connection"
          FOREIGN KEY ("connection_id")
          REFERENCES "social_ad_account_connections" ("id") ON DELETE CASCADE
      )
    `);

    // One live run per connection per intent. Partial on the two active states
    // so a re-run of the same window next week is still allowed.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ad_sync_runs_inflight"
        ON "social_ad_sync_runs" ("connection_id", "idempotency_key")
        WHERE "status" IN ('queued', 'processing')
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_ad_sync_runs_queue"
        ON "social_ad_sync_runs" ("available_at")
        WHERE "status" = 'queued'
    `);
    // Runs whose worker died holding the lease.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_ad_sync_runs_stale_lock"
        ON "social_ad_sync_runs" ("locked_at")
        WHERE "status" = 'processing'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_ad_sync_runs_connection"
        ON "social_ad_sync_runs" ("connection_id", "created_at" DESC)
    `);
    // No index on "retain_until": the column is where a retention policy will
    // write, and no sweeper reads it yet. Indexing it now would cost every run
    // a write for a query nobody makes.

    // ----------------------------------------------------------------- metrics
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_ad_metrics_daily" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "connection_id" uuid NOT NULL,
        "provider" varchar(40) NOT NULL,
        "source" varchar(24) NOT NULL DEFAULT 'paid',
        "entity_level" varchar(20) NOT NULL,
        "entity_external_id" varchar(180) NOT NULL,
        "campaign_external_id" varchar(180),
        -- A calendar day in the ad account's timezone, not an instant: giving
        -- it a timestamp would invite a second, wrong conversion on every read.
        "metric_date" date NOT NULL,
        -- Required, never assumed. Reading a America/Sao_Paulo day as UTC moves
        -- an evening's spend into the next day.
        "account_timezone" varchar(64) NOT NULL,
        -- Nullable because the source dimension outlives paid delivery: an
        -- organic row has reach and no money.
        "currency" varchar(8),
        "attribution_setting" varchar(60) NOT NULL DEFAULT 'account_default',
        -- numeric, never float: this column is what a client is invoiced
        -- against, and binary floating point drifts when summed over a quarter.
        "spend" numeric(18,6) NOT NULL DEFAULT 0,
        "impressions" bigint NOT NULL DEFAULT 0,
        -- Nullable and non-additive: reach is de-duplicated people, so summing
        -- two days double-counts anyone present on both. No aggregation logic
        -- is implemented in this slice.
        "reach" bigint,
        "clicks" bigint NOT NULL DEFAULT 0,
        "link_clicks" bigint NOT NULL DEFAULT 0,
        "leads" bigint NOT NULL DEFAULT 0,
        -- Fractional under attribution splitting: one conversion credited
        -- across two ads is two halves.
        "conversions" numeric(18,6) NOT NULL DEFAULT 0,
        "conversion_value" numeric(18,6) NOT NULL DEFAULT 0,
        "video_views" bigint NOT NULL DEFAULT 0,
        "actions" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "is_partial" boolean NOT NULL DEFAULT false,
        "synced_at" timestamptz NOT NULL DEFAULT now(),
        "sync_run_id" uuid,
        "raw" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_social_ad_metrics_daily_level"
          CHECK ("entity_level" IN ('account', 'campaign', 'adset', 'ad')),
        -- Negative spend or a negative impression count is not something Meta
        -- can legitimately return; it is a parsing bug, and this keeps it out
        -- of a client-facing total.
        --
        -- Deliberately absent: any bound of "metric_date" against CURRENT_DATE.
        -- The date belongs to the ad account's timezone and CURRENT_DATE to the
        -- database server's, so an account east of the server has legitimate
        -- facts that look like tomorrow for part of every day — and Postgres
        -- rejects the non-immutable expression in a CHECK regardless. Date
        -- sanity belongs to the ingest, which knows the account timezone.
        CONSTRAINT "CK_social_ad_metrics_daily_non_negative"
          CHECK (
            "spend" >= 0
            AND "impressions" >= 0
            AND "clicks" >= 0
            AND "link_clicks" >= 0
            AND "leads" >= 0
            AND "conversions" >= 0
            AND "conversion_value" >= 0
            AND "video_views" >= 0
            AND ("reach" IS NULL OR "reach" >= 0)
          ),
        CONSTRAINT "FK_social_ad_metrics_daily_connection"
          FOREIGN KEY ("connection_id")
          REFERENCES "social_ad_account_connections" ("id") ON DELETE CASCADE,
        -- SET NULL, never cascade: pruning old run logs must not delete the
        -- facts those runs produced.
        CONSTRAINT "FK_social_ad_metrics_daily_sync_run"
          FOREIGN KEY ("sync_run_id")
          REFERENCES "social_ad_sync_runs" ("id") ON DELETE SET NULL
      )
    `);

    // The idempotency of the whole ingest: this is the conflict target of the
    // future INSERT … ON CONFLICT DO UPDATE, so it defines what "the same
    // fact" means. Meta restates recent days for up to 28 days, so re-reading
    // a window must update in place — two rows for one day double the spend on
    // every report that sums them.
    //
    // "source" and "attribution_setting" are part of the key on purpose.
    // Without "source", the first organic ingest overwrites the paid row it
    // sits next to. Without "attribution_setting", pulling a 7-day window
    // silently overwrites the number already reported to a client instead of
    // landing beside it.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ad_metrics_daily_fact"
        ON "social_ad_metrics_daily"
        ("tenant_id", "workspace_id", "connection_id", "source",
         "entity_level", "entity_external_id", "metric_date", "attribution_setting")
    `);
    // The shape of every dashboard read: one client, one level, a date range.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_ad_metrics_daily_read"
        ON "social_ad_metrics_daily"
        ("tenant_id", "workspace_id", "agency_client_id", "entity_level", "metric_date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_ad_metrics_daily_campaign"
        ON "social_ad_metrics_daily"
        ("connection_id", "campaign_external_id", "metric_date")
    `);
    // Partial in both senses: it indexes only the rows still awaiting a
    // restatement, so "what must be re-read?" stays small however large the
    // settled history grows.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_ad_metrics_daily_partial"
        ON "social_ad_metrics_daily" ("connection_id", "metric_date")
        WHERE "is_partial"
    `);

    // No ratio columns anywhere above. CTR, CPC, CPM, CPL, CPA, ROAS and
    // frequency are quotients of columns already here, and a stored quotient
    // becomes a lie the moment two rows are summed: averaging CTRs weights a
    // thousand-impression day like a million-impression one.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse dependency order: the facts reference the runs, and both
    // reference the connection table this migration does not own.
    await queryRunner.query(`DROP TABLE IF EXISTS "social_ad_metrics_daily"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_ad_sync_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_ad_entities"`);
  }
}
