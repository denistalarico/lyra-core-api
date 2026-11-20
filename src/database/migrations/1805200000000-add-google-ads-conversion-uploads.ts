import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * GA-CONV (2026-11-20): offline click conversions back to Google Ads.
 * Plan: docs/sprints/social/social-google-ads-leads-analytics-plan-2026-11-18.md (§4.2 D-G6, revised).
 *
 * - `google_ads_conversion_upload_settings`: one row per Google Ads
 *   connection: the two `UPLOAD_CLICKS` actions, the "qualified" stage of each
 *   funnel and whether the won value is sent. Off by default.
 * - `google_ads_conversion_uploads`: one row per (connection, transaction id
 *   `<opportunityId>:<qualified|won>`): idempotency and per-row state.
 *   Only ids, the click id, times, value and error codes; never lead PII.
 */
export class AddGoogleAdsConversionUploads1805200000000 implements MigrationInterface {
  name = 'AddGoogleAdsConversionUploads1805200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "google_ads_conversion_upload_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid NULL,
        "company_context_id" uuid NULL,
        "connection_id" uuid NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "qualified_action_resource" varchar(200) NULL,
        "won_action_resource" varchar(200) NULL,
        "qualified_stage_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "send_value" boolean NOT NULL DEFAULT true,
        "created_by_id" uuid NULL,
        "updated_by_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_google_ads_conversion_upload_settings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_google_ads_conversion_upload_settings_connection" UNIQUE ("connection_id"),
        CONSTRAINT "FK_google_ads_conversion_upload_settings_connection"
          FOREIGN KEY ("connection_id") REFERENCES "social_ad_account_connections"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_google_ads_conversion_upload_settings_actions" CHECK (
          ("qualified_action_resource" IS NULL OR "qualified_action_resource" ~ '^customers/[0-9]+/conversionActions/[0-9]+$')
          AND ("won_action_resource" IS NULL OR "won_action_resource" ~ '^customers/[0-9]+/conversionActions/[0-9]+$')
          AND jsonb_typeof("qualified_stage_ids") = 'array'
        )
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "google_ads_conversion_uploads" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid NULL,
        "company_context_id" uuid NULL,
        "connection_id" uuid NOT NULL,
        "crm" varchar(16) NOT NULL,
        "opportunity_id" uuid NOT NULL,
        "kind" varchar(16) NOT NULL,
        "transaction_id" varchar(80) NOT NULL,
        "form_submission_id" uuid NULL,
        "gclid" varchar(200) NOT NULL,
        "conversion_action" varchar(200) NOT NULL,
        "conversion_at" timestamptz NOT NULL,
        "conversion_value" numeric(18,2) NULL,
        "currency_code" varchar(3) NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
        "error_code" varchar(120) NULL,
        "request_id" varchar(120) NULL,
        "uploaded_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_google_ads_conversion_uploads" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_google_ads_conversion_uploads_transaction" UNIQUE ("connection_id", "transaction_id"),
        CONSTRAINT "FK_google_ads_conversion_uploads_connection"
          FOREIGN KEY ("connection_id") REFERENCES "social_ad_account_connections"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_google_ads_conversion_uploads_values" CHECK (
          "crm" IN ('agency_sales', 'leadflow_crm')
          AND "kind" IN ('qualified', 'won')
          AND "status" IN ('pending', 'uploaded', 'failed')
          AND "attempts" >= 0
          AND ("conversion_value" IS NULL OR "conversion_value" >= 0)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_google_ads_conversion_uploads_due"
        ON "google_ads_conversion_uploads" ("next_attempt_at")
        WHERE "status" = 'pending'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_google_ads_conversion_uploads_history"
        ON "google_ads_conversion_uploads" ("connection_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "google_ads_conversion_uploads"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "google_ads_conversion_upload_settings"`,
    );
  }
}
