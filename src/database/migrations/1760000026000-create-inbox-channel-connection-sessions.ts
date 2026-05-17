import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInboxChannelConnectionSessions1760000026000
  implements MigrationInterface
{
  name = 'CreateInboxChannelConnectionSessions1760000026000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbox_channel_connection_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        user_id uuid,
        provider varchar(40) NOT NULL,
        channel_type varchar(40) NOT NULL,
        status varchar(32) NOT NULL DEFAULT 'pending',
        state varchar(160) NOT NULL,
        code text,
        business_id varchar(180),
        waba_id varchar(180),
        phone_number_id varchar(180),
        display_phone_number varchar(80),
        error_message text,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        expires_at timestamptz NOT NULL,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbox_channel_connection_sessions_tenant_workspace
      ON inbox_channel_connection_sessions (tenant_id, workspace_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbox_channel_connection_sessions_state
      ON inbox_channel_connection_sessions (state)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbox_channel_connection_sessions_status
      ON inbox_channel_connection_sessions (status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_inbox_channel_connection_sessions_provider_type
      ON inbox_channel_connection_sessions (provider, channel_type)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_inbox_channel_connection_sessions_provider_type`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_inbox_channel_connection_sessions_status`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_inbox_channel_connection_sessions_state`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_inbox_channel_connection_sessions_tenant_workspace`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS inbox_channel_connection_sessions`,
    );
  }
}
