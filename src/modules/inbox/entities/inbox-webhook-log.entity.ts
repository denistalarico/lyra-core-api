import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type InboxWebhookProvider = 'meta' | 'whatsapp' | 'webchat' | 'email' | 'other';

export type InboxWebhookStatus = 'received' | 'processed' | 'failed' | 'ignored';

@Entity('inbox_webhook_logs')
@Index('idx_inbox_webhook_logs_provider', ['provider'])
@Index('idx_inbox_webhook_logs_channel', ['channelId'])
@Index('idx_inbox_webhook_logs_created_at', ['createdAt'])
@Index('idx_inbox_webhook_logs_tenant_workspace', ['tenantId', 'workspaceId'])
export class InboxWebhookLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId!: string | null;

  @Column({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId!: string | null;

  @Column({ type: 'varchar', length: 40 })
  provider!: InboxWebhookProvider;

  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType!: string;

  @Column({ type: 'varchar', length: 32, default: 'received' })
  status!: InboxWebhookStatus;

  @Column({ name: 'external_account_id', type: 'varchar', length: 180, nullable: true })
  externalAccountId!: string | null;

  @Column({ name: 'external_phone_number_id', type: 'varchar', length: 180, nullable: true })
  externalPhoneNumberId!: string | null;

  @Column({ name: 'external_message_id', type: 'varchar', length: 220, nullable: true })
  externalMessageId!: string | null;

  @Column({ name: 'signature_received', type: 'boolean', default: false })
  signatureReceived!: boolean;

  @Column({ name: 'messages_processed', type: 'int', default: 0 })
  messagesProcessed!: number;

  @Column({ name: 'statuses_processed', type: 'int', default: 0 })
  statusesProcessed!: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
