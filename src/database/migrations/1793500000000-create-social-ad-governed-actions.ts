import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSocialAdGovernedActions1793500000000 implements MigrationInterface {
  name = 'CreateSocialAdGovernedActions1793500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_ad_action_policies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "connection_id" uuid NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "allow_status" boolean NOT NULL DEFAULT true,
        "allow_budget" boolean NOT NULL DEFAULT false,
        "allow_schedule" boolean NOT NULL DEFAULT false,
        "allow_delete" boolean NOT NULL DEFAULT false,
        "max_budget_minor" bigint,
        "max_budget_increase_percent" integer NOT NULL DEFAULT 25,
        "confirmation_ttl_minutes" integer NOT NULL DEFAULT 10,
        "created_by_id" uuid,
        "updated_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_ad_action_policies" PRIMARY KEY ("id"),
        CONSTRAINT "FK_social_ad_action_policy_connection"
          FOREIGN KEY ("connection_id")
          REFERENCES "social_ad_account_connections"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_social_ad_action_policy_limits" CHECK (
          ("max_budget_minor" IS NULL OR "max_budget_minor" > 0)
          AND "max_budget_increase_percent" BETWEEN 0 AND 100
          AND "confirmation_ttl_minutes" BETWEEN 1 AND 60
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ad_action_policies_agency"
      ON "social_ad_action_policies" ("tenant_id", "workspace_id", "connection_id")
      WHERE "agency_client_id" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ad_action_policies_client"
      ON "social_ad_action_policies"
        ("tenant_id", "workspace_id", "agency_client_id", "connection_id")
      WHERE "agency_client_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_ad_governed_actions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "connection_id" uuid NOT NULL,
        "entity_level" varchar(20) NOT NULL,
        "entity_external_id" varchar(180) NOT NULL,
        "entity_name" text,
        "action_type" varchar(30) NOT NULL,
        "status" varchar(30) NOT NULL,
        "request_id" uuid NOT NULL,
        "confirmation_request_id" uuid,
        "before_snapshot" jsonb NOT NULL,
        "requested_change" jsonb NOT NULL,
        "provider_result" jsonb,
        "confirmation_phrase" varchar(240),
        "expires_at" timestamptz NOT NULL,
        "proposed_by_id" uuid,
        "confirmed_by_id" uuid,
        "error_code" varchar(120),
        "executed_at" timestamptz,
        "verified_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_ad_governed_actions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_social_ad_governed_action_connection"
          FOREIGN KEY ("connection_id")
          REFERENCES "social_ad_account_connections"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_social_ad_governed_action_level"
          CHECK ("entity_level" IN ('campaign', 'adset', 'ad')),
        CONSTRAINT "CK_social_ad_governed_action_type"
          CHECK ("action_type" IN ('set_status', 'set_budget', 'set_end_time', 'delete')),
        CONSTRAINT "CK_social_ad_governed_action_status"
          CHECK ("status" IN ('pending_confirmation', 'executing', 'verified', 'succeeded_unverified', 'blocked', 'failed', 'expired'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ad_governed_actions_request"
      ON "social_ad_governed_actions" ("request_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_ad_governed_actions_confirmation"
      ON "social_ad_governed_actions" ("confirmation_request_id")
      WHERE "confirmation_request_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_ad_governed_actions_scope"
      ON "social_ad_governed_actions"
        ("tenant_id", "workspace_id", "agency_client_id", "connection_id", "created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_ad_governed_actions"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "social_ad_action_policies"`);
  }
}
