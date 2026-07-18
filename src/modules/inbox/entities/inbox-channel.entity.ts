import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type InboxChannelType =
  | 'internal'
  | 'manual'
  | 'webchat'
  | 'whatsapp'
  | 'instagram'
  | 'facebook_messenger'
  | 'facebook'
  | 'email'
  | 'phone'
  | 'other';

export type InboxChannelStatus = 'draft' | 'active' | 'inactive' | 'archived';
export type InboxChannelConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'disconnected'
  | 'error'
  | 'suspended';

@Entity('inbox_channels')
@Index('idx_inbox_channels_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_inbox_channels_type', ['tenantId', 'workspaceId', 'type'])
@Index('idx_inbox_channels_status', ['tenantId', 'workspaceId', 'status'])
export class InboxChannelEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 140 })
  name!: string;

  @Column({ type: 'varchar', length: 40, default: 'manual' })
  type!: InboxChannelType;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status!: InboxChannelStatus;

  @Column({
    name: 'connection_status',
    type: 'varchar',
    length: 24,
    default: 'connected',
  })
  connectionStatus!: InboxChannelConnectionStatus;

  @Column({ name: 'lifecycle_version', type: 'int', default: 1 })
  lifecycleVersion!: number;

  @Column({ name: 'credential_version', type: 'int', default: 0 })
  credentialVersion!: number;

  @Column({ type: 'varchar', length: 80, nullable: true })
  provider!: string | null;

  @Column({ name: 'external_id', type: 'varchar', length: 180, nullable: true })
  externalId!: string | null;

  @Column({
    name: 'external_account_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  externalAccountId!: string | null;

  @Column({
    name: 'external_phone_number_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  externalPhoneNumberId!: string | null;

  @Column({
    name: 'external_page_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  externalPageId!: string | null;

  @Column({ name: 'access_token_encrypted', type: 'text', nullable: true })
  accessTokenEncrypted!: string | null;

  @Column({
    name: 'verify_token',
    type: 'varchar',
    length: 220,
    nullable: true,
  })
  verifyToken!: string | null;

  @Column({
    name: 'webhook_secret',
    type: 'varchar',
    length: 220,
    nullable: true,
  })
  webhookSecret!: string | null;

  @Column({ name: 'default_assigned_user_id', type: 'uuid', nullable: true })
  defaultAssignedUserId!: string | null;

  @Column({ name: 'default_agent_id', type: 'uuid', nullable: true })
  defaultAgentId!: string | null;

  @Column({ name: 'ai_enabled', type: 'boolean', default: false })
  aiEnabled!: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  settings!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt!: Date | null;

  @Column({ name: 'disconnected_at', type: 'timestamptz', nullable: true })
  disconnectedAt!: Date | null;

  @Column({ name: 'disconnected_by', type: 'uuid', nullable: true })
  disconnectedBy!: string | null;

  @Column({
    name: 'disconnect_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  disconnectReason!: string | null;

  @Column({
    name: 'credential_removed_at',
    type: 'timestamptz',
    nullable: true,
  })
  credentialRemovedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
