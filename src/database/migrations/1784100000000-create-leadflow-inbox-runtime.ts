import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLeadflowInboxRuntime1784100000000 implements MigrationInterface {
  name = 'CreateLeadflowInboxRuntime1784100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE inbox_conversations
        ADD COLUMN IF NOT EXISTS opportunity_id uuid,
        ADD COLUMN IF NOT EXISTS ownership_state varchar(32) NOT NULL DEFAULT 'paused',
        ADD COLUMN IF NOT EXISTS ownership_version int NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS ownership_reason varchar(180),
        ADD COLUMN IF NOT EXISTS ownership_changed_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS qualification_status varchar(32) NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS qualification_reason varchar(180)
    `);
    await queryRunner.query(`
      ALTER TABLE inbox_messages
        ADD COLUMN IF NOT EXISTS occurred_at timestamptz,
        ADD COLUMN IF NOT EXISTS provider_sequence bigint,
        ADD COLUMN IF NOT EXISTS idempotency_key varchar(180)
    `);
    await queryRunner.query(
      `UPDATE inbox_messages SET occurred_at = COALESCE(sent_at, created_at) WHERE occurred_at IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE inbox_messages ALTER COLUMN occurred_at SET NOT NULL`,
    );

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_channel_meta_phone
      ON inbox_channels (provider, type, external_phone_number_id)
      WHERE deleted_at IS NULL AND status = 'active' AND external_phone_number_id IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_conversation_external_thread
      ON inbox_conversations (tenant_id, workspace_id, channel_id, external_thread_id)
      WHERE external_thread_id IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_message_provider_external
      ON inbox_messages (tenant_id, workspace_id, channel_id, external_message_id)
      WHERE channel_id IS NOT NULL AND external_message_id IS NOT NULL
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_message_idempotency ON inbox_messages (tenant_id, workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbox_messages_chronological
      ON inbox_messages (tenant_id, workspace_id, conversation_id, occurred_at, provider_sequence, id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbox_media_assets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        message_id uuid NOT NULL,
        channel_id uuid NOT NULL,
        kind varchar(24) NOT NULL,
        provider varchar(40) NOT NULL,
        external_media_id varchar(220) NOT NULL,
        mime_type varchar(120),
        byte_size bigint,
        checksum varchar(128),
        safe_filename varchar(220),
        object_key text,
        status varchar(24) NOT NULL DEFAULT 'pending',
        attempt_count int NOT NULL DEFAULT 0,
        next_attempt_at timestamptz,
        available_at timestamptz,
        error_code varchar(80),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_inbox_media_status CHECK (status IN ('pending','processing','available','failed')),
        CONSTRAINT chk_inbox_media_kind CHECK (kind IN ('audio','image','video','document'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_inbox_media_scope ON inbox_media_assets (tenant_id, workspace_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_inbox_media_message ON inbox_media_assets (tenant_id, workspace_id, message_id)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_media_provider_ref ON inbox_media_assets (tenant_id, workspace_id, channel_id, provider, external_media_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbox_media_derivatives (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL, media_asset_id uuid NOT NULL,
        kind varchar(32) NOT NULL, status varchar(24) NOT NULL DEFAULT 'pending',
        content text, language varchar(20), confidence numeric(6,5),
        provider varchar(80), model varchar(120), processor_version varchar(80) NOT NULL,
        error_code varchar(80), created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_inbox_derivative_status CHECK (status IN ('pending','processing','available','failed'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_inbox_media_derivative_scope ON inbox_media_derivatives (tenant_id, workspace_id, media_asset_id)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_media_derivative_processor ON inbox_media_derivatives (tenant_id, workspace_id, media_asset_id, kind, processor_version)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbox_processing_batches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL, conversation_id uuid NOT NULL, channel_id uuid NOT NULL,
        generation int NOT NULL DEFAULT 1, status varchar(24) NOT NULL DEFAULT 'pending',
        due_at timestamptz NOT NULL, message_count int NOT NULL DEFAULT 1,
        claimed_at timestamptz, claimed_by varchar(100), completed_at timestamptz,
        error_code varchar(80), created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_inbox_batch_status CHECK (status IN ('pending','processing','completed','failed','cancelled'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_inbox_batch_due ON inbox_processing_batches (status, due_at)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_batch_open_conversation ON inbox_processing_batches (tenant_id, workspace_id, conversation_id, generation)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbox_agent_decisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL, conversation_id uuid NOT NULL, batch_id uuid NOT NULL,
        agent_id uuid, agent_version_id uuid, ownership_version int NOT NULL,
        schema_version int NOT NULL DEFAULT 1, idempotency_key varchar(180) NOT NULL,
        correlation_id uuid NOT NULL, status varchar(24) NOT NULL DEFAULT 'proposed',
        proposal jsonb NOT NULL DEFAULT '{}'::jsonb, policy_result jsonb NOT NULL DEFAULT '{}'::jsonb,
        context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, error_code varchar(80),
        reviewed_by uuid, reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_inbox_decision_status CHECK (status IN ('proposed','approved','rejected','invalidated','failed'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_inbox_decision_scope ON inbox_agent_decisions (tenant_id, workspace_id, conversation_id)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_decision_idempotency ON inbox_agent_decisions (tenant_id, workspace_id, idempotency_key)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbox_domain_outbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL, aggregate_type varchar(60) NOT NULL,
        aggregate_id uuid NOT NULL, event_name varchar(120) NOT NULL,
        event_version int NOT NULL DEFAULT 1, idempotency_key varchar(180) NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb, published_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_inbox_outbox_pending ON inbox_domain_outbox (published_at, created_at)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_outbox_idempotency ON inbox_domain_outbox (tenant_id, workspace_id, idempotency_key)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_domain_outbox`);
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_agent_decisions`);
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_processing_batches`);
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_media_derivatives`);
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_media_assets`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_inbox_messages_chronological`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_inbox_message_provider_external`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_inbox_conversation_external_thread`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS uq_inbox_channel_meta_phone`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_inbox_message_idempotency`,
    );
    await queryRunner.query(
      `ALTER TABLE inbox_messages DROP COLUMN IF EXISTS idempotency_key, DROP COLUMN IF EXISTS provider_sequence, DROP COLUMN IF EXISTS occurred_at`,
    );
    await queryRunner.query(
      `ALTER TABLE inbox_conversations DROP COLUMN IF EXISTS qualification_reason, DROP COLUMN IF EXISTS qualification_status, DROP COLUMN IF EXISTS ownership_changed_at, DROP COLUMN IF EXISTS ownership_reason, DROP COLUMN IF EXISTS ownership_version, DROP COLUMN IF EXISTS ownership_state, DROP COLUMN IF EXISTS opportunity_id`,
    );
  }
}
