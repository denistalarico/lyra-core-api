import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSocialCampaignMonitor1793300000000
  implements MigrationInterface
{
  name = 'CreateSocialCampaignMonitor1793300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_campaign_monitor_policies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "connection_id" uuid NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "daily_spend_limit_minor" bigint,
        "monthly_spend_limit_minor" bigint,
        "balance_floor_minor" bigint,
        "cooldown_minutes" integer NOT NULL DEFAULT 360,
        "delivery_channels" jsonb NOT NULL DEFAULT '["in_app"]'::jsonb,
        "created_by_id" uuid,
        "updated_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_campaign_monitor_policies" PRIMARY KEY ("id"),
        CONSTRAINT "FK_social_campaign_monitor_policy_connection"
          FOREIGN KEY ("connection_id")
          REFERENCES "social_ad_account_connections"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_social_campaign_monitor_policy_limits" CHECK (
          ("daily_spend_limit_minor" IS NULL OR "daily_spend_limit_minor" >= 100)
          AND ("monthly_spend_limit_minor" IS NULL OR "monthly_spend_limit_minor" >= 100)
          AND ("balance_floor_minor" IS NULL OR "balance_floor_minor" >= 0)
          AND "cooldown_minutes" BETWEEN 15 AND 10080
          AND (NOT "enabled" OR "daily_spend_limit_minor" IS NOT NULL
            OR "monthly_spend_limit_minor" IS NOT NULL
            OR "balance_floor_minor" IS NOT NULL)
        ),
        CONSTRAINT "CK_social_campaign_monitor_policy_channels" CHECK (
          jsonb_typeof("delivery_channels") = 'array'
          AND "delivery_channels" @> '["in_app"]'::jsonb
          AND "delivery_channels" <@ '["in_app", "email", "whatsapp"]'::jsonb
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_campaign_monitor_policies_connection"
      ON "social_campaign_monitor_policies" ("connection_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_campaign_monitor_policies_due"
      ON "social_campaign_monitor_policies" ("enabled", "updated_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_campaign_alerts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "connection_id" uuid NOT NULL,
        "policy_id" uuid NOT NULL,
        "alert_type" varchar(40) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'open',
        "current_value_minor" bigint NOT NULL,
        "threshold_minor" bigint NOT NULL,
        "currency" varchar(8) NOT NULL,
        "period_key" varchar(20) NOT NULL,
        "deduplication_key" varchar(64) NOT NULL,
        "occurrence_count" integer NOT NULL DEFAULT 1,
        "first_triggered_at" timestamptz NOT NULL,
        "last_triggered_at" timestamptz NOT NULL,
        "acknowledged_at" timestamptz,
        "acknowledged_by_id" uuid,
        "resolved_at" timestamptz,
        "observed_at" timestamptz,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_campaign_alerts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_social_campaign_alert_policy"
          FOREIGN KEY ("policy_id")
          REFERENCES "social_campaign_monitor_policies"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_social_campaign_alert_connection"
          FOREIGN KEY ("connection_id")
          REFERENCES "social_ad_account_connections"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_social_campaign_alert_values" CHECK (
          "current_value_minor" >= 0
          AND "threshold_minor" >= 0
          AND "occurrence_count" > 0
        ),
        CONSTRAINT "CK_social_campaign_alert_type" CHECK (
          "alert_type" IN ('daily_spend_limit', 'monthly_spend_limit', 'low_balance')
        ),
        CONSTRAINT "CK_social_campaign_alert_status" CHECK (
          "status" IN ('open', 'acknowledged', 'resolved')
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_campaign_alerts_deduplication"
      ON "social_campaign_alerts" ("deduplication_key")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_campaign_alerts_scope_status"
      ON "social_campaign_alerts"
        ("tenant_id", "workspace_id", "agency_client_id", "connection_id", "status", "last_triggered_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "social_campaign_alerts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_campaign_monitor_policies"`);
  }
}
