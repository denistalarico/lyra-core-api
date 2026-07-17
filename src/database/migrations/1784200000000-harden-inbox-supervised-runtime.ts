import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenInboxSupervisedRuntime1784200000000 implements MigrationInterface {
  name = 'HardenInboxSupervisedRuntime1784200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE inbox_media_derivatives
        ADD COLUMN IF NOT EXISTS asset_checksum varchar(128),
        ADD COLUMN IF NOT EXISTS outcome varchar(24),
        ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS available_at timestamptz,
        ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
        ADD COLUMN IF NOT EXISTS locked_at timestamptz,
        ADD COLUMN IF NOT EXISTS locked_by varchar(120),
        ADD COLUMN IF NOT EXISTS completed_at timestamptz,
        ADD COLUMN IF NOT EXISTS usage jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS latency_ms int,
        ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE inbox_media_derivatives
        ADD CONSTRAINT chk_inbox_derivative_outcome
        CHECK (outcome IS NULL OR outcome IN ('content','empty','indeterminate'))
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_inbox_derivative_claim ON inbox_media_derivatives (status, next_attempt_at, locked_at, created_at)`,
    );

    await queryRunner.query(`
      ALTER TABLE inbox_processing_batches
        ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE inbox_agent_decisions
        ADD COLUMN IF NOT EXISTS provider varchar(80),
        ADD COLUMN IF NOT EXISTS model varchar(120),
        ADD COLUMN IF NOT EXISTS prompt_version varchar(80),
        ADD COLUMN IF NOT EXISTS prompt_hash varchar(128),
        ADD COLUMN IF NOT EXISTS usage jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS latency_ms int,
        ADD COLUMN IF NOT EXISTS action_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS applied_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS applied_at timestamptz
    `);

    await queryRunner.query(`
      ALTER TABLE inbox_domain_outbox
        ADD COLUMN IF NOT EXISTS status varchar(24) NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS locked_at timestamptz,
        ADD COLUMN IF NOT EXISTS locked_by varchar(120),
        ADD COLUMN IF NOT EXISTS last_error varchar(80),
        ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz,
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
    `);
    await queryRunner.query(
      `UPDATE inbox_domain_outbox SET status = CASE WHEN published_at IS NULL THEN 'pending' ELSE 'published' END`,
    );
    await queryRunner.query(`
      ALTER TABLE inbox_domain_outbox
        ADD CONSTRAINT chk_inbox_outbox_status
        CHECK (status IN ('pending','processing','published','dead_letter'))
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_inbox_outbox_claim ON inbox_domain_outbox (status, available_at, locked_at, created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inbox_outbox_claim`);
    await queryRunner.query(
      `ALTER TABLE inbox_domain_outbox DROP CONSTRAINT IF EXISTS chk_inbox_outbox_status, DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS dead_lettered_at, DROP COLUMN IF EXISTS last_error, DROP COLUMN IF EXISTS locked_by, DROP COLUMN IF EXISTS locked_at, DROP COLUMN IF EXISTS available_at, DROP COLUMN IF EXISTS attempts, DROP COLUMN IF EXISTS status`,
    );
    await queryRunner.query(
      `ALTER TABLE inbox_agent_decisions DROP COLUMN IF EXISTS applied_at, DROP COLUMN IF EXISTS applied_actions, DROP COLUMN IF EXISTS action_plan, DROP COLUMN IF EXISTS latency_ms, DROP COLUMN IF EXISTS usage, DROP COLUMN IF EXISTS prompt_hash, DROP COLUMN IF EXISTS prompt_version, DROP COLUMN IF EXISTS model, DROP COLUMN IF EXISTS provider`,
    );
    await queryRunner.query(
      `ALTER TABLE inbox_processing_batches DROP COLUMN IF EXISTS attempt_count`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_inbox_derivative_claim`);
    await queryRunner.query(
      `ALTER TABLE inbox_media_derivatives DROP CONSTRAINT IF EXISTS chk_inbox_derivative_outcome, DROP COLUMN IF EXISTS metadata, DROP COLUMN IF EXISTS latency_ms, DROP COLUMN IF EXISTS usage, DROP COLUMN IF EXISTS completed_at, DROP COLUMN IF EXISTS locked_by, DROP COLUMN IF EXISTS locked_at, DROP COLUMN IF EXISTS next_attempt_at, DROP COLUMN IF EXISTS available_at, DROP COLUMN IF EXISTS attempt_count, DROP COLUMN IF EXISTS outcome, DROP COLUMN IF EXISTS asset_checksum`,
    );
  }
}
