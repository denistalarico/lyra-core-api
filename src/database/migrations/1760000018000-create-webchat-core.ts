import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWebchatCore1760000018000 implements MigrationInterface {
  name = 'CreateWebchatCore1760000018000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webchat_widgets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        name varchar(140) NOT NULL,
        slug varchar(160) NOT NULL,
        status varchar(32) NOT NULL DEFAULT 'draft',
        public_key uuid NOT NULL DEFAULT gen_random_uuid(),
        allowed_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
        title varchar(120) NOT NULL DEFAULT 'Olá! Como podemos ajudar?',
        subtitle varchar(180),
        initial_message text,
        primary_color varchar(24) NOT NULL DEFAULT '#2563EB',
        position varchar(32) NOT NULL DEFAULT 'bottom-right',
        default_locale varchar(16) NOT NULL DEFAULT 'pt-BR',
        ai_enabled boolean NOT NULL DEFAULT false,
        default_agent_id uuid,
        agent_display_name varchar(120),
        agent_avatar_url text,
        brand_footer_enabled boolean NOT NULL DEFAULT true,
        brand_footer_text varchar(180) NOT NULL DEFAULT 'By Lyra Suite',
        lead_capture_enabled boolean NOT NULL DEFAULT false,
        lead_capture_mode varchar(32) NOT NULL DEFAULT 'optional',
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_webchat_widgets_status CHECK (status IN ('draft', 'active', 'inactive')),
        CONSTRAINT chk_webchat_widgets_position CHECK (position IN ('bottom-right', 'bottom-left')),
        CONSTRAINT chk_webchat_widgets_lead_capture_mode CHECK (lead_capture_mode IN ('before_chat', 'during_chat', 'optional'))
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webchat_visitors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        widget_id uuid NOT NULL,
        contact_id uuid,
        anonymous_id varchar(160) NOT NULL,
        name varchar(160),
        email varchar(180),
        phone varchar(60),
        ip_hash varchar(128),
        user_agent text,
        locale varchar(16),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        first_seen_at timestamptz,
        last_seen_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webchat_conversations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        widget_id uuid NOT NULL,
        visitor_id uuid NOT NULL,
        contact_id uuid,
        status varchar(32) NOT NULL DEFAULT 'new',
        source varchar(40) NOT NULL DEFAULT 'webchat',
        page_url text,
        page_title varchar(220),
        referrer text,
        utm_source varchar(120),
        utm_medium varchar(120),
        utm_campaign varchar(160),
        assigned_user_id uuid,
        assigned_agent_id uuid,
        ai_enabled boolean NOT NULL DEFAULT false,
        last_message_at timestamptz,
        closed_at timestamptz,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_webchat_conversations_status CHECK (status IN ('new', 'active', 'waiting', 'handoff_requested', 'resolved', 'closed', 'archived'))
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webchat_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        widget_id uuid NOT NULL,
        conversation_id uuid NOT NULL,
        visitor_id uuid,
        sender_type varchar(32) NOT NULL,
        sender_user_id uuid,
        sender_agent_id uuid,
        direction varchar(24) NOT NULL,
        message_type varchar(32) NOT NULL DEFAULT 'text',
        content text NOT NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_webchat_messages_sender_type CHECK (sender_type IN ('visitor', 'agent', 'ai', 'system')),
        CONSTRAINT chk_webchat_messages_direction CHECK (direction IN ('inbound', 'outbound')),
        CONSTRAINT chk_webchat_messages_type CHECK (message_type IN ('text', 'system', 'event'))
      );
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_webchat_widgets_public_key ON webchat_widgets (public_key);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_widgets_tenant_workspace ON webchat_widgets (tenant_id, workspace_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_widgets_status ON webchat_widgets (tenant_id, workspace_id, status);`);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_visitors_tenant_workspace ON webchat_visitors (tenant_id, workspace_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_visitors_widget ON webchat_visitors (widget_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_visitors_anonymous ON webchat_visitors (widget_id, anonymous_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_visitors_contact ON webchat_visitors (contact_id);`);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_conversations_tenant_workspace ON webchat_conversations (tenant_id, workspace_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_conversations_widget ON webchat_conversations (widget_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_conversations_visitor ON webchat_conversations (visitor_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_conversations_contact ON webchat_conversations (contact_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_conversations_status ON webchat_conversations (tenant_id, workspace_id, status);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_conversations_last_message ON webchat_conversations (tenant_id, workspace_id, last_message_at);`);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_messages_tenant_workspace ON webchat_messages (tenant_id, workspace_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_messages_widget ON webchat_messages (widget_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_messages_conversation ON webchat_messages (conversation_id);`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_webchat_messages_created_at ON webchat_messages (conversation_id, created_at);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS webchat_messages;`);
    await queryRunner.query(`DROP TABLE IF EXISTS webchat_conversations;`);
    await queryRunner.query(`DROP TABLE IF EXISTS webchat_visitors;`);
    await queryRunner.query(`DROP TABLE IF EXISTS webchat_widgets;`);
  }
}
