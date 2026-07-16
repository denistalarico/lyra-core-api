import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLeadflowOperationsRoom1783900000000 implements MigrationInterface {
  name = 'CreateLeadflowOperationsRoom1783900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "leadflow_operations_room_revision" (
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "room_version" bigint NOT NULL DEFAULT 0,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_room_revision" PRIMARY KEY ("tenant_id", "workspace_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "leadflow_agent_operational_state" (
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agent_id" uuid NOT NULL,
        "status" varchar(40) NOT NULL,
        "status_since" timestamptz NOT NULL,
        "agent_revision" bigint NOT NULL DEFAULT 0,
        "room_version" bigint NOT NULL DEFAULT 0,
        "source" varchar(40) NOT NULL,
        "source_event_id" varchar(160),
        "reason_code" varchar(80),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_room_agent_state" PRIMARY KEY ("tenant_id", "workspace_id", "agent_id"),
        CONSTRAINT "FK_lf_room_state_agent" FOREIGN KEY ("agent_id") REFERENCES "leadflow_agents" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_lf_room_state_status" CHECK ("status" IN ('unknown','available','handling_conversation','handoff_requested','paused','error','meeting','reporting','offline')),
        CONSTRAINT "CK_lf_room_state_source" CHECK ("source" IN ('system','agent-runtime','inbox','handoff','meeting','reporting'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_room_state_context" ON "leadflow_agent_operational_state" ("tenant_id", "workspace_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_room_state_revision" ON "leadflow_agent_operational_state" ("tenant_id", "workspace_id", "agent_revision")
    `);

    await queryRunner.query(`
      CREATE TABLE "leadflow_operations_room_event_outbox" (
        "event_id" uuid NOT NULL,
        "contract_version" integer NOT NULL DEFAULT 1,
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "room_version" bigint NOT NULL,
        "agent_id" uuid,
        "agent_revision" bigint,
        "event_type" varchar(80) NOT NULL,
        "occurred_at" timestamptz NOT NULL,
        "source" varchar(40) NOT NULL,
        "source_event_id" varchar(160),
        "correlation_id" varchar(160),
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "delivery_state" varchar(20) NOT NULL DEFAULT 'pending',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_room_outbox" PRIMARY KEY ("event_id"),
        CONSTRAINT "FK_lf_room_outbox_agent" FOREIGN KEY ("agent_id") REFERENCES "leadflow_agents" ("id") ON DELETE SET NULL,
        CONSTRAINT "CK_lf_room_outbox_source" CHECK ("source" IN ('system','agent-runtime','inbox','handoff','meeting','reporting')),
        CONSTRAINT "CK_lf_room_outbox_delivery" CHECK ("delivery_state" IN ('pending'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_lf_room_outbox_source_event"
      ON "leadflow_operations_room_event_outbox" ("tenant_id", "workspace_id", "source", "source_event_id")
      WHERE "source_event_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_room_outbox_context_version"
      ON "leadflow_operations_room_event_outbox" ("tenant_id", "workspace_id", "room_version")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_room_outbox_source_event"
      ON "leadflow_operations_room_event_outbox" ("tenant_id", "workspace_id", "source", "source_event_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_room_outbox_source_event"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_room_outbox_context_version"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_lf_room_outbox_source_event"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "leadflow_operations_room_event_outbox"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_room_state_revision"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lf_room_state_context"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "leadflow_agent_operational_state"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "leadflow_operations_room_revision"`,
    );
  }
}
