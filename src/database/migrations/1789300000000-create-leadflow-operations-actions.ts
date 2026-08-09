import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLeadflowOperationsActions1789300000000 implements MigrationInterface {
  name = 'CreateLeadflowOperationsActions1789300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_operations_actions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "settings_id" uuid NOT NULL,
        "business_mode_key" varchar(80) NOT NULL,
        "intent" varchar(60) NOT NULL,
        "status" varchar(30) NOT NULL DEFAULT 'pending_confirmation',
        "request_text" text NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "preview" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "resource_key" varchar(160),
        "timezone" varchar(120),
        "effective_from" timestamptz,
        "effective_until" timestamptz,
        "validation_issues" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "idempotency_key" varchar(160),
        "revision" integer NOT NULL DEFAULT 1,
        "created_by_id" uuid,
        "confirmed_by_id" uuid,
        "confirmed_at" timestamptz,
        "cancelled_by_id" uuid,
        "cancelled_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_operations_actions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_operations_actions_settings" FOREIGN KEY ("settings_id") REFERENCES "leadflow_client_settings"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_lf_operations_actions_intent" CHECK ("intent" IN ('update_offer_price','schedule_discount','add_closure','update_business_hours','capacity_unavailable','capacity_released')),
        CONSTRAINT "CK_lf_operations_actions_status" CHECK ("status" IN ('pending_confirmation','confirmed','cancelled')),
        CONSTRAINT "CK_lf_operations_actions_revision" CHECK ("revision" > 0),
        CONSTRAINT "CK_lf_operations_actions_period" CHECK ("effective_until" IS NULL OR "effective_from" IS NULL OR "effective_until" > "effective_from")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_ops_actions_context_created"
      ON "leadflow_operations_actions" ("tenant_id", "workspace_id", "settings_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_ops_actions_context_status"
      ON "leadflow_operations_actions" ("tenant_id", "workspace_id", "settings_id", "status")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_ops_actions_idempotency"
      ON "leadflow_operations_actions" ("tenant_id", "workspace_id", "settings_id", "idempotency_key")
      WHERE "idempotency_key" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_operations_action_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "action_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "event_type" varchar(30) NOT NULL,
        "actor_id" uuid,
        "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_operations_action_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_operations_action_events_action" FOREIGN KEY ("action_id") REFERENCES "leadflow_operations_actions"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_lf_operations_action_events_type" CHECK ("event_type" IN ('proposed','confirmed','cancelled'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_ops_action_events_action_created"
      ON "leadflow_operations_action_events" ("action_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_ops_action_events_context_created"
      ON "leadflow_operations_action_events" ("tenant_id", "workspace_id", "created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "leadflow_operations_action_events"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "leadflow_operations_actions"`,
    );
  }
}
