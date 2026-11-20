import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * GA-DET (2026-11-20): Google Ads campaign details.
 * Plan: docs/sprints/social/social-google-ads-leads-analytics-plan-2026-11-18.md (§4.2 D-G3, D-G4).
 *
 * - D-G3: `social_ad_breakdown_daily` admits `ad_network` (where the campaign
 *   served) and `conversion_action` (which conversion it was), at campaign
 *   level, and gains `conversions` / `conversion_value`. Both are NULL for the
 *   Meta dimensions: Meta keeps its conversions inside `actions`, so NULL there
 *   means "not measured here", never zero.
 * - D-G4: `social_ad_search_terms_daily` holds search terms, keywords and PMax
 *   search categories per campaign and day. `campaign_search_term_insight`
 *   accepts `segments.date` in v25, so PMax is daily too (no period table).
 *   `spend` is NULL where Google does not report cost (PMax categories).
 */
export class AddGoogleAdsCampaignDetails1805000000000 implements MigrationInterface {
  name = 'AddGoogleAdsCampaignDetails1805000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_ad_breakdown_daily"
        DROP CONSTRAINT IF EXISTS "CK_social_ad_breakdown_daily_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_ad_breakdown_daily"
        ADD CONSTRAINT "CK_social_ad_breakdown_daily_kind"
        CHECK ("breakdown_kind" IN (
          'age_gender',
          'device_platform',
          'publisher_platform',
          'hourly',
          'ad_network',
          'conversion_action'
        ))
    `);
    await queryRunner.query(`
      ALTER TABLE "social_ad_breakdown_daily"
        ADD COLUMN IF NOT EXISTS "conversions" numeric(18,6) NULL,
        ADD COLUMN IF NOT EXISTS "conversion_value" numeric(18,6) NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_ad_search_terms_daily" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid NULL,
        "connection_id" uuid NOT NULL,
        "provider" varchar(40) NOT NULL,
        "campaign_external_id" varchar(180) NOT NULL,
        "metric_date" date NOT NULL,
        "account_timezone" varchar(64) NOT NULL,
        "currency" varchar(8) NULL,
        "term_kind" varchar(20) NOT NULL,
        "term_text" varchar(512) NOT NULL,
        "term_hash" char(64) NOT NULL,
        "impressions" bigint NOT NULL DEFAULT 0,
        "clicks" bigint NOT NULL DEFAULT 0,
        "spend" numeric(18,6) NULL,
        "conversions" numeric(18,6) NOT NULL DEFAULT 0,
        "conversion_value" numeric(18,6) NOT NULL DEFAULT 0,
        "is_partial" boolean NOT NULL DEFAULT false,
        "synced_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_ad_search_terms_daily" PRIMARY KEY ("id"),
        CONSTRAINT "CK_social_ad_search_terms_daily_kind"
          CHECK ("term_kind" IN ('search_term', 'keyword', 'pmax_category')),
        CONSTRAINT "CK_social_ad_search_terms_daily_non_negative"
          CHECK ("impressions" >= 0 AND "clicks" >= 0
            AND ("spend" IS NULL OR "spend" >= 0)
            AND "conversions" >= 0 AND "conversion_value" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ad_search_terms_daily_fact"
        ON "social_ad_search_terms_daily" (
          "tenant_id", "workspace_id", "connection_id", "campaign_external_id",
          "metric_date", "term_kind", "term_hash"
        )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_ad_search_terms_daily_read"
        ON "social_ad_search_terms_daily" (
          "tenant_id", "workspace_id", "connection_id", "campaign_external_id",
          "term_kind", "metric_date"
        )
    `);
  }

  /**
   * Narrows the CHECK back, so the rows it would refuse go first. Every one of
   * them is re-readable from Google by the next campaign-level sync.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_ad_search_terms_daily"`,
    );
    await queryRunner.query(`
      DELETE FROM "social_ad_breakdown_daily"
        WHERE "breakdown_kind" IN ('ad_network', 'conversion_action')
    `);
    await queryRunner.query(`
      ALTER TABLE "social_ad_breakdown_daily"
        DROP COLUMN IF EXISTS "conversion_value",
        DROP COLUMN IF EXISTS "conversions"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_ad_breakdown_daily"
        DROP CONSTRAINT IF EXISTS "CK_social_ad_breakdown_daily_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_ad_breakdown_daily"
        ADD CONSTRAINT "CK_social_ad_breakdown_daily_kind"
        CHECK ("breakdown_kind" IN (
          'age_gender',
          'device_platform',
          'publisher_platform',
          'hourly'
        ))
    `);
  }
}
