import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAppointmentsCore1760000019000 implements MigrationInterface {
  name = 'CreateAppointmentsCore1760000019000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scheduled_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,

        type varchar(32) NOT NULL,
        status varchar(32) NOT NULL DEFAULT 'scheduled',
        priority varchar(32) NOT NULL DEFAULT 'medium',

        title varchar(180) NOT NULL,
        description text NULL,
        notes text NULL,

        start_at timestamptz NULL,
        end_at timestamptz NULL,
        due_at timestamptz NULL,
        all_day boolean NOT NULL DEFAULT false,
        timezone varchar(80) NULL,

        location_type varchar(32) NOT NULL DEFAULT 'none',
        location_text text NULL,

        video_mode varchar(32) NULL,
        video_url text NULL,
        phone_url text NULL,

        visibility varchar(32) NOT NULL DEFAULT 'workspace',

        owner_user_id uuid NULL,
        assigned_user_id uuid NULL,
        created_by_user_id uuid NULL,
        contact_id uuid NULL,

        source_channel varchar(32) NOT NULL DEFAULT 'manual',
        source_conversation_id uuid NULL,
        source_lead_id uuid NULL,
        source_opportunity_id uuid NULL,

        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz NULL,

        CONSTRAINT chk_scheduled_items_type CHECK (
          type IN ('event', 'meeting', 'follow_up', 'task', 'call', 'reminder')
        ),
        CONSTRAINT chk_scheduled_items_status CHECK (
          status IN ('scheduled', 'in_progress', 'completed', 'canceled', 'missed', 'postponed')
        ),
        CONSTRAINT chk_scheduled_items_priority CHECK (
          priority IN ('low', 'medium', 'high', 'urgent')
        ),
        CONSTRAINT chk_scheduled_items_location_type CHECK (
          location_type IN ('none', 'physical', 'video', 'phone')
        ),
        CONSTRAINT chk_scheduled_items_video_mode CHECK (
          video_mode IS NULL OR video_mode IN ('external_url', 'native')
        ),
        CONSTRAINT chk_scheduled_items_visibility CHECK (
          visibility IN ('private', 'workspace', 'participants')
        ),
        CONSTRAINT chk_scheduled_items_source_channel CHECK (
          source_channel IN ('manual', 'email', 'whatsapp', 'inbox', 'phone', 'webchat', 'instagram', 'facebook', 'other')
        ),
        CONSTRAINT chk_scheduled_items_time_range CHECK (
          start_at IS NULL OR end_at IS NULL OR end_at >= start_at
        )
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scheduled_item_participants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,

        scheduled_item_id uuid NOT NULL,
        participant_type varchar(32) NOT NULL,

        user_id uuid NULL,
        contact_id uuid NULL,
        external_name varchar(180) NULL,
        external_email varchar(180) NULL,
        external_phone varchar(80) NULL,

        response_status varchar(32) NOT NULL DEFAULT 'needs_action',
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT fk_scheduled_item_participants_item
          FOREIGN KEY (scheduled_item_id)
          REFERENCES scheduled_items(id)
          ON DELETE CASCADE,

        CONSTRAINT chk_scheduled_item_participants_type CHECK (
          participant_type IN ('user', 'contact', 'external')
        ),
        CONSTRAINT chk_scheduled_item_participants_response_status CHECK (
          response_status IN ('needs_action', 'accepted', 'declined', 'tentative')
        ),
        CONSTRAINT chk_scheduled_item_participants_identity CHECK (
          (
            participant_type = 'user'
            AND user_id IS NOT NULL
          )
          OR
          (
            participant_type = 'contact'
            AND contact_id IS NOT NULL
          )
          OR
          (
            participant_type = 'external'
            AND (
              external_name IS NOT NULL
              OR external_email IS NOT NULL
              OR external_phone IS NOT NULL
            )
          )
        )
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scheduled_item_reminders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,

        scheduled_item_id uuid NOT NULL,
        reminder_type varchar(32) NOT NULL,
        offset_minutes integer NOT NULL,

        status varchar(32) NOT NULL DEFAULT 'pending',
        scheduled_at timestamptz NULL,
        sent_at timestamptz NULL,

        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT fk_scheduled_item_reminders_item
          FOREIGN KEY (scheduled_item_id)
          REFERENCES scheduled_items(id)
          ON DELETE CASCADE,

        CONSTRAINT chk_scheduled_item_reminders_type CHECK (
          reminder_type IN ('app', 'email', 'whatsapp', 'webhook')
        ),
        CONSTRAINT chk_scheduled_item_reminders_status CHECK (
          status IN ('pending', 'sent', 'canceled', 'failed')
        )
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_items_tenant_workspace
        ON scheduled_items (tenant_id, workspace_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_items_workspace_status
        ON scheduled_items (workspace_id, status);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_items_workspace_type
        ON scheduled_items (workspace_id, type);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_items_workspace_start_at
        ON scheduled_items (workspace_id, start_at);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_items_workspace_due_at
        ON scheduled_items (workspace_id, due_at);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_items_assigned_user_id
        ON scheduled_items (assigned_user_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_items_contact_id
        ON scheduled_items (contact_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_items_source_conversation_id
        ON scheduled_items (source_conversation_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_items_source_lead_id
        ON scheduled_items (source_lead_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_items_source_opportunity_id
        ON scheduled_items (source_opportunity_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_item_participants_tenant_workspace
        ON scheduled_item_participants (tenant_id, workspace_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_item_participants_item
        ON scheduled_item_participants (scheduled_item_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_item_participants_user_id
        ON scheduled_item_participants (user_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_item_participants_contact_id
        ON scheduled_item_participants (contact_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_item_reminders_tenant_workspace
        ON scheduled_item_reminders (tenant_id, workspace_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_item_reminders_item
        ON scheduled_item_reminders (scheduled_item_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_item_reminders_status
        ON scheduled_item_reminders (workspace_id, status);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_scheduled_item_reminders_scheduled_at
        ON scheduled_item_reminders (workspace_id, scheduled_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS scheduled_item_reminders;`);
    await queryRunner.query(`DROP TABLE IF EXISTS scheduled_item_participants;`);
    await queryRunner.query(`DROP TABLE IF EXISTS scheduled_items;`);
  }
}
