import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContractAiAssistRuns1799200000000 implements MigrationInterface {
  name = 'CreateContractAiAssistRuns1799200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_contract_ai_assist_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "idempotency_key" varchar(120) NOT NULL,
        "input_sha256" varchar(64) NOT NULL,
        "input_chars" integer NOT NULL CHECK ("input_chars" > 0),
        "target_type" varchar(20) NOT NULL CHECK ("target_type" = 'client'),
        "status" varchar(20) NOT NULL CHECK ("status" IN ('processing','succeeded','failed')),
        "error_code" varchar(80),
        "model" varchar(160) NOT NULL,
        "prompt_version" varchar(80) NOT NULL,
        "usage" jsonb,
        "result" jsonb,
        "latency_ms" integer,
        "created_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "finished_at" timestamptz,
        CONSTRAINT "PK_contract_ai_assist_runs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_contract_ai_assist_runs_key" UNIQUE ("tenant_id","workspace_id","idempotency_key")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_contract_ai_assist_runs_daily"
      ON "agency_contract_ai_assist_runs" ("tenant_id","workspace_id","created_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "agency_contract_ai_assist_runs"',
    );
  }
}
