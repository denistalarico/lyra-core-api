import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenInboxAssistedMode1784530000000 implements MigrationInterface {
  name = 'HardenInboxAssistedMode1784530000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "inbox_agent_decisions"
        ADD COLUMN "review_idempotency_key" varchar(180),
        ADD COLUMN "review_intent_hash" char(64),
        ADD COLUMN "review_response_snapshot" jsonb,
        ADD COLUMN "review_audit_ref" uuid,
        ADD COLUMN "review_expected_version" varchar(180)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_inbox_decision_review_idempotency"
      ON "inbox_agent_decisions" ("tenant_id", "workspace_id", "review_idempotency_key")
      WHERE "review_idempotency_key" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE TABLE "inbox_meta_operations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "channel_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "message_id" uuid,
        "operation" varchar(40) NOT NULL,
        "idempotency_key" varchar(180) NOT NULL,
        "attempt" integer NOT NULL DEFAULT 1,
        "state" varchar(24) NOT NULL DEFAULT 'reserved',
        "recipient_hash" char(64) NOT NULL,
        "recipient_masked" varchar(32) NOT NULL,
        "external_ref_hash" char(64),
        "latency_ms" integer,
        "error_category" varchar(80),
        "cost_status" varchar(20) NOT NULL DEFAULT 'unknown',
        "estimated_cost_usd" numeric(12,6),
        "delivery_status" varchar(24),
        "delivery_updated_at" timestamptz,
        "started_at" timestamptz,
        "succeeded_at" timestamptz,
        "failed_at" timestamptz,
        "replayed_at" timestamptz,
        "replay_count" integer NOT NULL DEFAULT 0,
        "retain_until" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_inbox_meta_operations" PRIMARY KEY ("id"),
        CONSTRAINT "chk_inbox_meta_operation_state" CHECK ("state" IN ('reserved','started','succeeded','failed','replayed','unknown_outcome')),
        CONSTRAINT "chk_inbox_meta_cost_status" CHECK ("cost_status" IN ('unknown','known','not_applicable')),
        CONSTRAINT "fk_inbox_meta_operation_channel" FOREIGN KEY ("channel_id") REFERENCES "inbox_channels"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_inbox_meta_operation_conversation" FOREIGN KEY ("conversation_id") REFERENCES "inbox_conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_inbox_meta_operation_message" FOREIGN KEY ("message_id") REFERENCES "inbox_messages"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_inbox_meta_operation_logical"
      ON "inbox_meta_operations" ("tenant_id", "workspace_id", "operation", "idempotency_key")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_inbox_meta_operation_message"
      ON "inbox_meta_operations" ("tenant_id", "workspace_id", "message_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_inbox_meta_operation_retention"
      ON "inbox_meta_operations" ("retain_until")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "inbox_meta_operations"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "uq_inbox_decision_review_idempotency"',
    );
    await queryRunner.query(`
      ALTER TABLE "inbox_agent_decisions"
        DROP COLUMN IF EXISTS "review_expected_version",
        DROP COLUMN IF EXISTS "review_audit_ref",
        DROP COLUMN IF EXISTS "review_response_snapshot",
        DROP COLUMN IF EXISTS "review_intent_hash",
        DROP COLUMN IF EXISTS "review_idempotency_key"
    `);
  }
}
