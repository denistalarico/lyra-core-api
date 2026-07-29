import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLeadflowCsatResponses1787900000000 implements MigrationInterface {
  name = 'CreateLeadflowCsatResponses1787900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_csat_responses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "automation_id" uuid NOT NULL,
        "automation_run_id" uuid,
        "contact_id" uuid,
        "conversation_id" uuid,
        "opportunity_id" uuid,
        "appointment_id" uuid,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "score" smallint,
        "idempotency_key" varchar(180) NOT NULL,
        "request_source_event_id" uuid,
        "response_source_event_id" uuid,
        "response_message_id" uuid,
        "requested_at" timestamptz NOT NULL,
        "responded_at" timestamptz,
        "expires_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_csat_responses" PRIMARY KEY ("id"),
        CONSTRAINT "CK_lf_csat_status" CHECK (
          "status" IN ('pending', 'responded', 'expired')
        ),
        CONSTRAINT "CK_lf_csat_score" CHECK (
          "score" IS NULL OR ("score" >= 1 AND "score" <= 5)
        ),
        CONSTRAINT "CK_lf_csat_response_state" CHECK (
          ("status" = 'responded' AND "score" IS NOT NULL AND "responded_at" IS NOT NULL)
          OR
          ("status" <> 'responded' AND "score" IS NULL AND "responded_at" IS NULL)
        ),
        CONSTRAINT "CK_lf_csat_subject" CHECK (
          "contact_id" IS NOT NULL
          OR "conversation_id" IS NOT NULL
          OR "opportunity_id" IS NOT NULL
          OR "appointment_id" IS NOT NULL
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_csat_scope_idempotency"
      ON "leadflow_csat_responses"
        ("tenant_id", "workspace_id", "idempotency_key")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_csat_scope_status_requested"
      ON "leadflow_csat_responses"
        ("tenant_id", "workspace_id", "status", "requested_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_csat_contact_requested"
      ON "leadflow_csat_responses"
        ("tenant_id", "workspace_id", "contact_id", "requested_at" DESC)
      WHERE "contact_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "leadflow_csat_responses"');
  }
}
