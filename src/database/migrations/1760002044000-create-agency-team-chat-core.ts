import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyTeamChatCore1760002044000
  implements MigrationInterface
{
  name = 'CreateAgencyTeamChatCore1760002044000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_chat_channels (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        kind varchar(40) NOT NULL DEFAULT 'channel',
        visibility varchar(60) NOT NULL DEFAULT 'private',
        status varchar(40) NOT NULL DEFAULT 'active',
        name varchar(160) NOT NULL,
        slug varchar(180),
        description text,
        related_client_id uuid,
        related_project_id uuid,
        related_task_id uuid,
        created_by_id uuid,
        metadata jsonb,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_channels_tenant_workspace
      ON agency_chat_channels (tenant_id, workspace_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_channels_kind
      ON agency_chat_channels (tenant_id, workspace_id, kind)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_channels_status
      ON agency_chat_channels (tenant_id, workspace_id, status)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_chat_channel_members (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        channel_id uuid NOT NULL,
        user_id uuid,
        team_member_id uuid,
        display_name varchar(160),
        role varchar(40) NOT NULL DEFAULT 'member',
        notification_level varchar(40) NOT NULL DEFAULT 'all',
        last_read_message_id uuid,
        last_read_at timestamptz,
        joined_at timestamptz,
        left_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_channel_members_tenant_workspace
      ON agency_chat_channel_members (tenant_id, workspace_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_channel_members_channel
      ON agency_chat_channel_members (channel_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_channel_members_user
      ON agency_chat_channel_members (tenant_id, workspace_id, user_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_chat_messages (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        channel_id uuid,
        meeting_room_id uuid,
        parent_message_id uuid,
        sender_user_id uuid,
        sender_team_member_id uuid,
        external_guest_id uuid,
        sender_display_name varchar(160),
        kind varchar(40) NOT NULL DEFAULT 'text',
        status varchar(40) NOT NULL DEFAULT 'sent',
        body text,
        metadata jsonb,
        delivered_at timestamptz,
        edited_at timestamptz,
        deleted_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_messages_tenant_workspace
      ON agency_chat_messages (tenant_id, workspace_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_messages_channel_created
      ON agency_chat_messages (channel_id, created_at)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_messages_meeting_created
      ON agency_chat_messages (meeting_room_id, created_at)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_messages_sender
      ON agency_chat_messages (sender_user_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_chat_message_reads (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        channel_id uuid NOT NULL,
        message_id uuid NOT NULL,
        user_id uuid,
        team_member_id uuid,
        read_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_message_reads_tenant_workspace
      ON agency_chat_message_reads (tenant_id, workspace_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_message_reads_message
      ON agency_chat_message_reads (message_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_message_reads_channel_user
      ON agency_chat_message_reads (channel_id, user_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_chat_attachments (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        message_id uuid,
        meeting_room_id uuid,
        uploaded_by_id uuid,
        kind varchar(40) NOT NULL DEFAULT 'other',
        file_name varchar(255) NOT NULL,
        original_file_name varchar(255),
        mime_type varchar(120) NOT NULL,
        size_bytes bigint NOT NULL,
        storage_provider varchar(80) NOT NULL DEFAULT 'minio',
        storage_key text NOT NULL,
        public_url text,
        width integer,
        height integer,
        duration_seconds integer,
        metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_attachments_tenant_workspace
      ON agency_chat_attachments (tenant_id, workspace_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_attachments_message
      ON agency_chat_attachments (message_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_meeting_rooms (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        title varchar(180) NOT NULL,
        description text,
        status varchar(40) NOT NULL DEFAULT 'scheduled',
        access_mode varchar(40) NOT NULL DEFAULT 'public_link',
        provider varchar(40) NOT NULL DEFAULT 'livekit',
        provider_room_name varchar(220),
        public_slug varchar(120) NOT NULL,
        channel_id uuid,
        related_client_id uuid,
        related_project_id uuid,
        related_task_id uuid,
        host_user_id uuid,
        starts_at timestamptz,
        started_at timestamptz,
        ended_at timestamptz,
        recording_enabled boolean NOT NULL DEFAULT false,
        transcription_enabled boolean NOT NULL DEFAULT false,
        ai_summary_enabled boolean NOT NULL DEFAULT true,
        metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agency_meeting_rooms_public_slug
      ON agency_meeting_rooms (public_slug)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_meeting_rooms_tenant_workspace
      ON agency_meeting_rooms (tenant_id, workspace_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_meeting_rooms_status
      ON agency_meeting_rooms (tenant_id, workspace_id, status)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_meeting_participants (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        meeting_room_id uuid NOT NULL,
        user_id uuid,
        team_member_id uuid,
        guest_name varchar(160),
        guest_email varchar(180),
        role varchar(40) NOT NULL DEFAULT 'member',
        status varchar(40) NOT NULL DEFAULT 'invited',
        provider_identity varchar(220),
        joined_at timestamptz,
        left_at timestamptz,
        metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_meeting_participants_tenant_workspace
      ON agency_meeting_participants (tenant_id, workspace_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_meeting_participants_room
      ON agency_meeting_participants (meeting_room_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_meeting_participants_identity
      ON agency_meeting_participants (provider_identity)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_meeting_events (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        meeting_room_id uuid NOT NULL,
        participant_id uuid,
        type varchar(120) NOT NULL,
        payload jsonb,
        occurred_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_meeting_events_tenant_workspace
      ON agency_meeting_events (tenant_id, workspace_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_meeting_events_room_occurred
      ON agency_meeting_events (meeting_room_id, occurred_at)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_meeting_ai_summaries (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        meeting_room_id uuid NOT NULL,
        status varchar(40) NOT NULL DEFAULT 'pending',
        summary text,
        topics jsonb,
        decisions jsonb,
        next_steps jsonb,
        action_items jsonb,
        transcript_ref text,
        model varchar(120),
        error_message text,
        requested_by_id uuid,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_meeting_ai_summaries_tenant_workspace
      ON agency_meeting_ai_summaries (tenant_id, workspace_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_meeting_ai_summaries_room
      ON agency_meeting_ai_summaries (meeting_room_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS agency_meeting_ai_summaries`);
    await queryRunner.query(`DROP TABLE IF EXISTS agency_meeting_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS agency_meeting_participants`);
    await queryRunner.query(`DROP TABLE IF EXISTS agency_meeting_rooms`);
    await queryRunner.query(`DROP TABLE IF EXISTS agency_chat_attachments`);
    await queryRunner.query(`DROP TABLE IF EXISTS agency_chat_message_reads`);
    await queryRunner.query(`DROP TABLE IF EXISTS agency_chat_messages`);
    await queryRunner.query(`DROP TABLE IF EXISTS agency_chat_channel_members`);
    await queryRunner.query(`DROP TABLE IF EXISTS agency_chat_channels`);
  }
}
