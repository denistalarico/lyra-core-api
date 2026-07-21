import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInboxGovernedActions1784540000000 implements MigrationInterface {
  name = 'CreateInboxGovernedActions1784540000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "inbox_governed_actions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "conversation_id" uuid NOT NULL,
        "decision_id" uuid NOT NULL,
        "ownership_version" integer NOT NULL,
        "policy_version" varchar(80) NOT NULL,
        "action_type" varchar(40) NOT NULL,
        "action_key" varchar(180) NOT NULL,
        "policy_outcome" varchar(24) NOT NULL,
        "reason_code" varchar(80) NOT NULL,
        "idempotency_key" varchar(220) NOT NULL,
        "intent_hash" char(64) NOT NULL,
        "audit_ref" uuid NOT NULL,
        "status" varchar(24) NOT NULL,
        "canonical_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "application_result" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "attempts" integer NOT NULL DEFAULT 0,
        "claimed_at" timestamptz,
        "claimed_by" varchar(100),
        "applied_at" timestamptz,
        "failed_at" timestamptz,
        "error_code" varchar(80),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_inbox_governed_actions" PRIMARY KEY ("id"),
        CONSTRAINT "fk_inbox_governed_action_conversation" FOREIGN KEY ("conversation_id") REFERENCES "inbox_conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_inbox_governed_action_decision" FOREIGN KEY ("decision_id") REFERENCES "inbox_agent_decisions"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_inbox_governed_action_outcome" CHECK ("policy_outcome" IN ('allowed','blocked','requires_human','stale','invalid')),
        CONSTRAINT "chk_inbox_governed_action_status" CHECK ("status" IN ('planned','blocked','requires_human','stale','invalid','claimed','applied','failed','unknown_outcome'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_inbox_governed_action_idempotency"
      ON "inbox_governed_actions" ("tenant_id", "workspace_id", "idempotency_key")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_inbox_governed_action_scope_status"
      ON "inbox_governed_actions" ("tenant_id", "workspace_id", "status", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_inbox_governed_action_decision"
      ON "inbox_governed_actions" ("tenant_id", "workspace_id", "decision_id")
    `);
    await queryRunner.query(`
      CREATE TABLE "inbox_channel_contact_identities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "channel_id" uuid NOT NULL,
        "contact_id" uuid NOT NULL,
        "external_identity_hash" char(64) NOT NULL,
        "identity_type" varchar(32) NOT NULL,
        "provenance" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_inbox_channel_contact_identities" PRIMARY KEY ("id"),
        CONSTRAINT "fk_inbox_channel_contact_identity_channel" FOREIGN KEY ("channel_id") REFERENCES "inbox_channels"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_inbox_channel_contact_identity_contact" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_inbox_channel_contact_identity"
      ON "inbox_channel_contact_identities"
        ("tenant_id", "workspace_id", "channel_id", "external_identity_hash")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_crm_opportunity_active_inbox_conversation"
      ON "crm_opportunities" ("tenant_id", "workspace_id", "inbox_conversation_id")
      WHERE "inbox_conversation_id" IS NOT NULL AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE TABLE "inbox_autonomy_controls" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "reply_enabled" boolean NOT NULL DEFAULT true,
        "crm_enabled" boolean NOT NULL DEFAULT true,
        "handoff_enabled" boolean NOT NULL DEFAULT true,
        "paused_at" timestamptz,
        "paused_by" uuid,
        "reason_code" varchar(80),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_inbox_autonomy_controls" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_inbox_autonomy_control_scope"
      ON "inbox_autonomy_controls" ("tenant_id", "workspace_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "inbox_autonomy_controls"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "uq_crm_opportunity_active_inbox_conversation"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "inbox_channel_contact_identities"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "inbox_governed_actions"');
  }
}
