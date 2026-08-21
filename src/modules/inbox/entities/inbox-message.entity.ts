import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type InboxMessageDirection =
  | 'inbound'
  | 'outbound'
  | 'internal'
  | 'system';
export type InboxMessageSenderType =
  | 'contact'
  | 'user'
  | 'agent'
  | 'system'
  | 'external';
export type InboxMessageType = 'text' | 'note' | 'media' | 'event' | 'template';
export type InboxMessageStatus =
  | 'draft'
  | 'received'
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

@Entity('inbox_messages')
@Index('idx_inbox_messages_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_inbox_messages_conversation', ['conversationId'])
@Index('idx_inbox_messages_channel', ['channelId'])
@Index('idx_inbox_messages_created_at', ['conversationId', 'createdAt'])
@Index(
  'uq_inbox_message_provider_external',
  ['tenantId', 'workspaceId', 'channelId', 'externalMessageId'],
  { unique: true },
)
@Index(
  'uq_inbox_message_idempotency',
  ['tenantId', 'workspaceId', 'idempotencyKey'],
  { unique: true },
)
export class InboxMessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId!: string | null;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ type: 'varchar', length: 24 })
  direction!: InboxMessageDirection;

  @Column({ name: 'sender_type', type: 'varchar', length: 32 })
  senderType!: InboxMessageSenderType;

  @Column({ name: 'sender_user_id', type: 'uuid', nullable: true })
  senderUserId!: string | null;

  @Column({ name: 'sender_agent_id', type: 'uuid', nullable: true })
  senderAgentId!: string | null;

  @Column({
    name: 'external_message_id',
    type: 'varchar',
    length: 220,
    nullable: true,
  })
  externalMessageId!: string | null;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  idempotencyKey!: string | null;

  @Column({
    name: 'message_type',
    type: 'varchar',
    length: 32,
    default: 'text',
  })
  messageType!: InboxMessageType;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'varchar', length: 24, default: 'sent' })
  status!: InboxMessageStatus;

  @Column({ name: 'attachments', type: 'jsonb', default: () => "'[]'::jsonb" })
  attachments!: unknown[];

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'provider_sequence', type: 'bigint', nullable: true })
  providerSequence!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
