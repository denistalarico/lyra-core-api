import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrepareLeadflowAgencyPilot1784400000000 implements MigrationInterface {
  name = 'PrepareLeadflowAgencyPilot1784400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE inbox_channels
        ADD COLUMN IF NOT EXISTS connection_status varchar(24) NOT NULL DEFAULT 'connected',
        ADD COLUMN IF NOT EXISTS lifecycle_version int NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS credential_version int NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
        ADD COLUMN IF NOT EXISTS disconnected_at timestamptz,
        ADD COLUMN IF NOT EXISTS disconnected_by uuid,
        ADD COLUMN IF NOT EXISTS disconnect_reason varchar(500),
        ADD COLUMN IF NOT EXISTS credential_removed_at timestamptz
    `);
    await queryRunner.query(`
      UPDATE inbox_channels
      SET connection_status = CASE status
        WHEN 'active' THEN 'connected'
        WHEN 'inactive' THEN 'suspended'
        WHEN 'archived' THEN 'disconnected'
        ELSE 'connecting'
      END,
      credential_version = CASE WHEN access_token_encrypted IS NULL THEN 0 ELSE 1 END
    `);
    await queryRunner.query(`
      ALTER TABLE inbox_channels
        ADD CONSTRAINT chk_inbox_channel_connection_status
        CHECK (connection_status IN ('connecting','connected','disconnecting','disconnected','error','suspended'))
    `);
    await queryRunner.query(`
      CREATE TABLE inbox_channel_lifecycle_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        channel_id uuid NOT NULL REFERENCES inbox_channels(id) ON DELETE RESTRICT,
        operation varchar(24) NOT NULL,
        idempotency_key varchar(180) NOT NULL,
        actor_user_id uuid,
        reason varchar(500),
        result_status varchar(24) NOT NULL DEFAULT 'completed',
        lifecycle_version int NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_inbox_channel_lifecycle_operation
          CHECK (operation IN ('pause','resume','disconnect','reconnect')),
        CONSTRAINT uq_inbox_channel_lifecycle_idempotency
          UNIQUE (tenant_id, workspace_id, channel_id, idempotency_key)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_inbox_channel_lifecycle_scope
      ON inbox_channel_lifecycle_requests (tenant_id, workspace_id, channel_id, created_at DESC)
    `);

    await queryRunner.query(`
      ALTER TABLE leadflow_client_settings
        ADD COLUMN IF NOT EXISTS company_context_schema_version int NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS company_context_draft jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS company_context_published jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS company_context_published_version int NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS company_context_published_hash varchar(64),
        ADD COLUMN IF NOT EXISTS company_context_published_at timestamptz,
        ADD COLUMN IF NOT EXISTS company_context_published_by uuid
    `);
    await queryRunner.query(`
      UPDATE leadflow_client_settings
      SET company_context_draft = jsonb_strip_nulls(jsonb_build_object(
        'schemaVersion', 1,
        'identity', jsonb_build_object(
          'publicName', client_prompt_config->'businessName',
          'summary', client_prompt_config->'businessSummary'
        ),
        'offers', COALESCE(client_prompt_config->'mainOffers', '[]'::jsonb),
        'service', jsonb_build_object(
          'businessHours', client_prompt_config->'businessHours',
          'handoffRules', client_prompt_config->'handoffRules'
        ),
        'legacyTone', client_prompt_config->'tone'
      )),
      company_context_published = CASE
        WHEN status = 'published' THEN jsonb_strip_nulls(jsonb_build_object(
          'schemaVersion', 1,
          'identity', jsonb_build_object(
            'publicName', client_prompt_config->'businessName',
            'summary', client_prompt_config->'businessSummary'
          ),
          'offers', COALESCE(client_prompt_config->'mainOffers', '[]'::jsonb),
          'service', jsonb_build_object(
            'businessHours', client_prompt_config->'businessHours',
            'handoffRules', client_prompt_config->'handoffRules'
          ),
          'legacyTone', client_prompt_config->'tone'
        )) ELSE '{}'::jsonb END,
      company_context_published_version = CASE WHEN status = 'published' THEN 1 ELSE 0 END
    `);

    await queryRunner.query(`
      ALTER TABLE inbox_agent_decisions
        ADD COLUMN IF NOT EXISTS context_version int,
        ADD COLUMN IF NOT EXISTS context_hash varchar(64),
        ADD COLUMN IF NOT EXISTS prompt_layers jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE inbox_agent_decisions
        DROP COLUMN IF EXISTS prompt_layers,
        DROP COLUMN IF EXISTS context_hash,
        DROP COLUMN IF EXISTS context_version
    `);
    await queryRunner.query(`
      ALTER TABLE leadflow_client_settings
        DROP COLUMN IF EXISTS company_context_published_by,
        DROP COLUMN IF EXISTS company_context_published_at,
        DROP COLUMN IF EXISTS company_context_published_hash,
        DROP COLUMN IF EXISTS company_context_published_version,
        DROP COLUMN IF EXISTS company_context_published,
        DROP COLUMN IF EXISTS company_context_draft,
        DROP COLUMN IF EXISTS company_context_schema_version
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_inbox_channel_lifecycle_scope`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS inbox_channel_lifecycle_requests`,
    );
    await queryRunner.query(`
      ALTER TABLE inbox_channels
        DROP CONSTRAINT IF EXISTS chk_inbox_channel_connection_status,
        DROP COLUMN IF EXISTS credential_removed_at,
        DROP COLUMN IF EXISTS disconnect_reason,
        DROP COLUMN IF EXISTS disconnected_by,
        DROP COLUMN IF EXISTS disconnected_at,
        DROP COLUMN IF EXISTS suspended_at,
        DROP COLUMN IF EXISTS credential_version,
        DROP COLUMN IF EXISTS lifecycle_version,
        DROP COLUMN IF EXISTS connection_status
    `);
  }
}
