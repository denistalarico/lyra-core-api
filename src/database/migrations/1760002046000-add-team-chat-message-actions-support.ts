import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTeamChatMessageActionsSupport1760002046000
  implements MigrationInterface
{
  name = 'AddTeamChatMessageActionsSupport1760002046000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agency_chat_channel_members
      ADD COLUMN IF NOT EXISTS muted_until timestamptz
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_channel_members_muted_until
      ON agency_chat_channel_members (tenant_id, workspace_id, muted_until)
      WHERE muted_until IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_channel_members_channel_user_active
      ON agency_chat_channel_members (tenant_id, workspace_id, channel_id, user_id)
      WHERE user_id IS NOT NULL AND left_at IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_messages_parent
      ON agency_chat_messages (parent_message_id)
      WHERE parent_message_id IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_messages_channel_active_created
      ON agency_chat_messages (channel_id, created_at DESC)
      WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_messages_metadata_gin
      ON agency_chat_messages
      USING GIN (metadata)
      WHERE metadata IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_messages_pinned
      ON agency_chat_messages (channel_id, created_at DESC)
      WHERE metadata @> '{"pinned": true}'::jsonb
        AND deleted_at IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_attachments_meeting
      ON agency_chat_attachments (meeting_room_id)
      WHERE meeting_room_id IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_chat_attachments_uploaded_by
      ON agency_chat_attachments (tenant_id, workspace_id, uploaded_by_id)
      WHERE uploaded_by_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_agency_chat_attachments_uploaded_by
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_agency_chat_attachments_meeting
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_agency_chat_messages_pinned
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_agency_chat_messages_metadata_gin
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_agency_chat_messages_channel_active_created
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_agency_chat_messages_parent
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_agency_chat_channel_members_channel_user_active
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_agency_chat_channel_members_muted_until
    `);
    await queryRunner.query(`
      ALTER TABLE agency_chat_channel_members
      DROP COLUMN IF EXISTS muted_until
    `);
  }
}
