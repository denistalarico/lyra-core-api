import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type WebchatMessageSenderType = 'visitor' | 'agent' | 'ai' | 'system';
export type WebchatMessageDirection = 'inbound' | 'outbound';
export type WebchatMessageType = 'text' | 'system' | 'event';

@Entity('webchat_messages')
@Index('idx_webchat_messages_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_webchat_messages_widget', ['widgetId'])
@Index('idx_webchat_messages_conversation', ['conversationId'])
@Index('idx_webchat_messages_created_at', ['conversationId', 'createdAt'])
export class WebchatMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'widget_id', type: 'uuid' })
  widgetId!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ name: 'visitor_id', type: 'uuid', nullable: true })
  visitorId!: string | null;

  @Column({ name: 'sender_type', type: 'varchar', length: 32 })
  senderType!: WebchatMessageSenderType;

  @Column({ name: 'sender_user_id', type: 'uuid', nullable: true })
  senderUserId!: string | null;

  @Column({ name: 'sender_agent_id', type: 'uuid', nullable: true })
  senderAgentId!: string | null;

  @Column({ type: 'varchar', length: 24 })
  direction!: WebchatMessageDirection;

  @Column({ name: 'message_type', type: 'varchar', length: 32, default: 'text' })
  messageType!: WebchatMessageType;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
