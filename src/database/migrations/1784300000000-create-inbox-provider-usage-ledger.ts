import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInboxProviderUsageLedger1784300000000 implements MigrationInterface {
  name = 'CreateInboxProviderUsageLedger1784300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbox_provider_usage_ledger (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        session_id varchar(120) NOT NULL,
        operation varchar(24) NOT NULL,
        idempotency_key varchar(240) NOT NULL,
        correlation_id varchar(120),
        provider varchar(80) NOT NULL,
        model varchar(160) NOT NULL,
        status varchar(24) NOT NULL DEFAULT 'reserved',
        reserved_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
        estimated_cost_usd numeric(12,6),
        input_tokens int,
        cached_input_tokens int,
        output_tokens int,
        audio_seconds numeric(12,3),
        image_count int NOT NULL DEFAULT 0,
        attempts int NOT NULL DEFAULT 0,
        latency_ms int,
        error_code varchar(80),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        CONSTRAINT chk_inbox_provider_usage_operation
          CHECK (operation IN ('decision','transcription','vision')),
        CONSTRAINT chk_inbox_provider_usage_status
          CHECK (status IN ('reserved','succeeded','failed','refused')),
        CONSTRAINT uq_inbox_provider_usage_idempotency
          UNIQUE (tenant_id, workspace_id, session_id, operation, idempotency_key)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbox_provider_usage_session
      ON inbox_provider_usage_ledger
        (tenant_id, workspace_id, session_id, operation, status, created_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_inbox_provider_usage_session`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_provider_usage_ledger`);
  }
}
