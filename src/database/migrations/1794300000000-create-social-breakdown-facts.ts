import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Etapa 2A — the two breakdown fact tables.
 *
 * Numbered `1794300000000` rather than the `1794200000000` the campaign plan
 * reserved: that number was taken by `ExpandBrandKitAssetContext` between the
 * plan being written and this being implemented. Etapa 2B's `1794210000000` is
 * still free and still sorts after the Brand Kit migration, so it needs no
 * change.
 *
 * Two tables rather than one, because they are two different grains measured
 * two different ways. `social_ad_breakdown_daily` is a daily *flow* of paid
 * delivery split by a Meta breakdown dimension; `social_organic_audience_daily`
 * is a lifetime *stock* of followers observed on a day. Forcing them together
 * would mean a table where half the rows must never be summed across days and
 * the other half must, with nothing in the schema saying which is which.
 */
export class CreateSocialBreakdownFacts1794300000000 implements MigrationInterface {
  name = 'CreateSocialBreakdownFacts1794300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    /**
     * Paid delivery for one day, split by one breakdown dimension.
     *
     * The columns mirror `social_ad_metrics_daily` deliberately — same types,
     * same scale, same nullability on `reach` — so that a breakdown row and the
     * unsplit row it came from are comparable without a conversion. What it does
     * *not* mirror is the promoted action columns (`leads`, `conversions`,
     * `conversion_value`, `video_views`): those are derived from `actions` by a
     * versioned mapping, and re-deriving them here would mean two places that
     * decide what a lead is. `actions` is stored whole; the read derives.
     *
     * `breakdown_kind` and `breakdown_key` are both in the unique key. A key
     * without `breakdown_kind` would let the `mobile_app` of a device split
     * collide with a publisher-platform value of the same name, which is not
     * hypothetical — Meta uses overlapping vocabularies across dimensions.
     */
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_ad_breakdown_daily" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid,
      "connection_id" uuid NOT NULL,
      "provider" varchar(40) NOT NULL,
      "entity_level" varchar(20) NOT NULL,
      "entity_external_id" varchar(180) NOT NULL,
      "metric_date" date NOT NULL,
      "account_timezone" varchar(64) NOT NULL,
      "currency" varchar(8),
      "breakdown_kind" varchar(32) NOT NULL,
      "breakdown_key" varchar(64) NOT NULL,
      "spend" numeric(18,6) NOT NULL DEFAULT 0,
      "impressions" bigint NOT NULL DEFAULT 0,
      "clicks" bigint NOT NULL DEFAULT 0,
      "link_clicks" bigint NOT NULL DEFAULT 0,
      "reach" bigint,
      "actions" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "is_partial" boolean NOT NULL DEFAULT false,
      "synced_at" timestamptz NOT NULL DEFAULT now(),
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_social_ad_breakdown_daily_level" CHECK ("entity_level" IN ('account', 'campaign', 'adset', 'ad')),
      CONSTRAINT "CK_social_ad_breakdown_daily_kind" CHECK ("breakdown_kind" IN ('age_gender', 'device_platform', 'publisher_platform')),
      CONSTRAINT "CK_social_ad_breakdown_daily_non_negative" CHECK (
        "spend" >= 0
        AND "impressions" >= 0
        AND "clicks" >= 0
        AND "link_clicks" >= 0
        AND ("reach" IS NULL OR "reach" >= 0)
      )
    )`);

    /**
     * The conflict target of the ingest's upsert.
     *
     * Meta restates recent days for up to 28 days, so a re-read of a window has
     * to update in place; without this key the second read of a day would double
     * every number it reports.
     *
     * Deliberately narrower than `UQ_social_ad_metrics_daily_fact`: there is no
     * `source` or `attribution_setting` column here, because this ingest asks for
     * exactly one of each (`paid`, the account's own setting) and a column whose
     * only value is a constant is a column nobody validates. Adding a second
     * attribution window later is a migration, and it should be — it changes what
     * "the same fact" means.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ad_breakdown_daily_fact" ON "social_ad_breakdown_daily" ("tenant_id", "workspace_id", "connection_id", "entity_level", "entity_external_id", "metric_date", "breakdown_kind", "breakdown_key")`,
    );

    // The shape of every breakdown read: one connection, one dimension, a range.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_ad_breakdown_daily_read" ON "social_ad_breakdown_daily" ("tenant_id", "workspace_id", "connection_id", "breakdown_kind", "metric_date")`,
    );

    // Partial in both senses, like the facts table's own: it indexes only rows
    // still awaiting restatement, so "what must be re-read?" stays a small scan.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_ad_breakdown_daily_partial" ON "social_ad_breakdown_daily" ("connection_id", "metric_date") WHERE "is_partial"`,
    );

    /**
     * Follower demographics, as observed on a day.
     *
     * `value` is a **stock**, not a flow: Meta reports follower demographics as
     * lifetime totals, so a row says "on this day, this many of the followers
     * were in this bucket". Summing two days would count the same people twice,
     * which is why the column is named `value` rather than anything additive and
     * why the read takes the newest day rather than a range sum. The same
     * distinction the organic post tables already draw between daily flow and
     * `*_lifetime` snapshot columns.
     *
     * `breakdown_key` is wider here (96) than on the paid table: a city key
     * carries a place name and a country code (`São Paulo, Brazil`), not a
     * provider enum.
     */
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "social_organic_audience_daily" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid,
      "asset_id" uuid NOT NULL,
      "provider" varchar(40) NOT NULL,
      "metric_date" date NOT NULL,
      "asset_timezone" varchar(64) NOT NULL,
      "breakdown_kind" varchar(32) NOT NULL,
      "breakdown_key" varchar(96) NOT NULL,
      "value" numeric(18,6) NOT NULL DEFAULT 0,
      "observed_at" timestamptz NOT NULL DEFAULT now(),
      "synced_at" timestamptz NOT NULL DEFAULT now(),
      "sync_run_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_social_organic_audience_daily_kind" CHECK ("breakdown_kind" IN ('age_gender', 'gender', 'age', 'city', 'country')),
      CONSTRAINT "CK_social_organic_audience_daily_non_negative" CHECK ("value" >= 0),
      CONSTRAINT "FK_social_organic_audience_daily_asset" FOREIGN KEY ("asset_id") REFERENCES "social_organic_assets" ("id") ON DELETE CASCADE
    )`);

    /**
     * One snapshot per asset per dimension per bucket per day.
     *
     * A resync on the same calendar day collapses onto the row already there,
     * which is the intended behaviour: a lifetime total re-read four hours later
     * is a better measurement of the same day, not a second one.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_organic_audience_daily_fact" ON "social_organic_audience_daily" ("asset_id", "metric_date", "breakdown_kind", "breakdown_key")`,
    );

    // The read is always "the newest snapshot of one dimension", so the date
    // descends in the index rather than being sorted after the fact.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_organic_audience_daily_read" ON "social_organic_audience_daily" ("tenant_id", "workspace_id", "asset_id", "breakdown_kind", "metric_date" DESC)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_organic_audience_daily"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "social_ad_breakdown_daily"');
  }
}
