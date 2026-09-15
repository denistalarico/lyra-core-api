import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSocialCampaignRecommendations1793400000000
  implements MigrationInterface
{
  name = 'CreateSocialCampaignRecommendations1793400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_campaign_recommendations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "connection_id" uuid NOT NULL,
        "request_id" uuid NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'processing',
        "period_since" date NOT NULL,
        "period_until" date NOT NULL,
        "evidence_hash" varchar(64) NOT NULL,
        "evidence_snapshot" jsonb NOT NULL,
        "summary" text,
        "recommendations" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "provider" varchar(80),
        "model" varchar(120),
        "prompt_version" varchar(40) NOT NULL,
        "input_tokens" integer,
        "cached_input_tokens" integer,
        "output_tokens" integer,
        "cost_cents" integer,
        "cost_is_estimated" boolean NOT NULL DEFAULT true,
        "latency_ms" integer,
        "attempts" integer NOT NULL DEFAULT 0,
        "failure_code" varchar(120),
        "requested_by_id" uuid,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_campaign_recommendations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_social_campaign_recommendation_connection"
          FOREIGN KEY ("connection_id")
          REFERENCES "social_ad_account_connections"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_social_campaign_recommendation_status"
          CHECK ("status" IN ('processing', 'succeeded', 'failed')),
        CONSTRAINT "CK_social_campaign_recommendation_period"
          CHECK ("period_since" <= "period_until"),
        CONSTRAINT "CK_social_campaign_recommendation_cost" CHECK (
          ("cost_cents" IS NULL OR "cost_cents" >= 0)
          AND ("input_tokens" IS NULL OR "input_tokens" >= 0)
          AND ("cached_input_tokens" IS NULL OR "cached_input_tokens" >= 0)
          AND ("output_tokens" IS NULL OR "output_tokens" >= 0)
          AND ("latency_ms" IS NULL OR "latency_ms" >= 0)
          AND "attempts" >= 0
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_campaign_recommendations_request"
      ON "social_campaign_recommendations" ("request_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_campaign_recommendations_scope"
      ON "social_campaign_recommendations"
        ("tenant_id", "workspace_id", "agency_client_id", "connection_id", "created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "social_campaign_recommendations"`);
  }
}
