import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInboxCore1760000020000 implements MigrationInterface {
  name = 'CreateInboxCore1760000020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbox_channels (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        name varchar(140) NOT NULL,
        type varchar(40) NOT NULL DEFAULT 'manual',
        status varchar(32) NOT NULL DEFAULT 'active',
        provider varchar(80),
        external_id varchar(180),
        default_assigned_user_id uuid,
        default_agent_id uuid,
        ai_enabled boolean NOT NULL DEFAULT false,
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbox_conversations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        channel_id uuid,
        contact_id uuid,
        external_thread_id varchar(220),
        title varchar(180),
        status varchar(32) NOT NULL DEFAULT 'new',
        priority varchar(24) NOT NULL DEFAULT 'normal',
        assigned_user_id uuid,
        assigned_agent_id uuid,
        source varchar(40) NOT NULL DEFAULT 'manual',
        business_mode varchar(80) NOT NULL DEFAULT 'general',
        last_message_preview varchar(260),
        last_message_at timestamptz,
        unread_count int NOT NULL DEFAULT 0,
        ai_enabled boolean NOT NULL DEFAULT false,
        closed_at timestamptz,
        archived_at timestamptz,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbox_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        channel_id uuid,
        contact_id uuid,
        direction varchar(24) NOT NULL,
        sender_type varchar(32) NOT NULL,
        sender_user_id uuid,
        sender_agent_id uuid,
        external_message_id varchar(220),
        message_type varchar(32) NOT NULL DEFAULT 'text',
        content text NOT NULL,
        status varchar(24) NOT NULL DEFAULT 'sent',
        attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        sent_at timestamptz,
        delivered_at timestamptz,
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbox_conversation_participants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        type varchar(32) NOT NULL,
        contact_id uuid,
        user_id uuid,
        agent_id uuid,
        display_name varchar(160),
        role varchar(40) NOT NULL DEFAULT 'member',
        joined_at timestamptz,
        left_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS inbox_conversation_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        event_type varchar(80) NOT NULL,
        actor_type varchar(32) NOT NULL DEFAULT 'system',
        actor_user_id uuid,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_channels_tenant_workspace ON inbox_channels (tenant_id, workspace_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_channels_type ON inbox_channels (tenant_id, workspace_id, type)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_channels_status ON inbox_channels (tenant_id, workspace_id, status)`);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_conversations_tenant_workspace ON inbox_conversations (tenant_id, workspace_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_conversations_channel ON inbox_conversations (channel_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_conversations_contact ON inbox_conversations (contact_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_conversations_status ON inbox_conversations (tenant_id, workspace_id, status)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_conversations_assigned_user ON inbox_conversations (tenant_id, workspace_id, assigned_user_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_conversations_last_message ON inbox_conversations (tenant_id, workspace_id, last_message_at)`);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_messages_tenant_workspace ON inbox_messages (tenant_id, workspace_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_messages_conversation ON inbox_messages (conversation_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_messages_channel ON inbox_messages (channel_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_messages_created_at ON inbox_messages (conversation_id, created_at)`);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_participants_tenant_workspace ON inbox_conversation_participants (tenant_id, workspace_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_participants_conversation ON inbox_conversation_participants (conversation_id)`);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_events_tenant_workspace ON inbox_conversation_events (tenant_id, workspace_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_events_conversation ON inbox_conversation_events (conversation_id)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_inbox_events_created_at ON inbox_conversation_events (conversation_id, created_at)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_conversation_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_conversation_participants`);
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_messages`);
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_conversations`);
    await queryRunner.query(`DROP TABLE IF EXISTS inbox_channels`);
  }
}
