import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type InboxChannelConnectionProvider = 'meta' | 'google' | 'microsoft' | 'other';

export type InboxChannelConnectionType =
  | 'whatsapp'
  | 'instagram'
  | 'facebook_messenger'
  | 'email'
  | 'calendar'
  | 'other';

export type InboxChannelConnectionStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'expired';

@Entity('inbox_channel_connection_sessions')
@Index('idx_inbox_channel_connection_sessions_tenant_workspace', [
  'tenantId',
  'workspaceId',
])
@Index('idx_inbox_channel_connection_sessions_state', ['state'])
@Index('idx_inbox_channel_connection_sessions_status', ['status'])
@Index('idx_inbox_channel_connection_sessions_provider_type', [
  'provider',
  'channelType',
])
export class InboxChannelConnectionSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', length: 40 })
  provider!: InboxChannelConnectionProvider;

  @Column({ name: 'channel_type', type: 'varchar', length: 40 })
  channelType!: InboxChannelConnectionType;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: InboxChannelConnectionStatus;

  @Column({ type: 'varchar', length: 160 })
  state!: string;

  @Column({ type: 'text', nullable: true })
  code!: string | null;

  @Column({ name: 'business_id', type: 'varchar', length: 180, nullable: true })
  businessId!: string | null;

  @Column({ name: 'waba_id', type: 'varchar', length: 180, nullable: true })
  wabaId!: string | null;

  @Column({ name: 'phone_number_id', type: 'varchar', length: 180, nullable: true })
  phoneNumberId!: string | null;

  @Column({
    name: 'display_phone_number',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  displayPhoneNumber!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
