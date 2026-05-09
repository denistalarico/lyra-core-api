import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type WebchatConversationStatus =
  | 'new'
  | 'active'
  | 'waiting'
  | 'handoff_requested'
  | 'resolved'
  | 'closed'
  | 'archived';

@Entity('webchat_conversations')
@Index('idx_webchat_conversations_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_webchat_conversations_widget', ['widgetId'])
@Index('idx_webchat_conversations_visitor', ['visitorId'])
@Index('idx_webchat_conversations_contact', ['contactId'])
@Index('idx_webchat_conversations_status', ['tenantId', 'workspaceId', 'status'])
@Index('idx_webchat_conversations_last_message', ['tenantId', 'workspaceId', 'lastMessageAt'])
export class WebchatConversationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'widget_id', type: 'uuid' })
  widgetId!: string;

  @Column({ name: 'visitor_id', type: 'uuid' })
  visitorId!: string;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'new' })
  status!: WebchatConversationStatus;

  @Column({ type: 'varchar', length: 40, default: 'webchat' })
  source!: string;

  @Column({ name: 'page_url', type: 'text', nullable: true })
  pageUrl!: string | null;

  @Column({ name: 'page_title', type: 'varchar', length: 220, nullable: true })
  pageTitle!: string | null;

  @Column({ type: 'text', nullable: true })
  referrer!: string | null;

  @Column({ name: 'utm_source', type: 'varchar', length: 120, nullable: true })
  utmSource!: string | null;

  @Column({ name: 'utm_medium', type: 'varchar', length: 120, nullable: true })
  utmMedium!: string | null;

  @Column({ name: 'utm_campaign', type: 'varchar', length: 160, nullable: true })
  utmCampaign!: string | null;

  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId!: string | null;

  @Column({ name: 'assigned_agent_id', type: 'uuid', nullable: true })
  assignedAgentId!: string | null;

  @Column({ name: 'ai_enabled', type: 'boolean', default: false })
  aiEnabled!: boolean;

  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt!: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
