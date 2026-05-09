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
  | 'manual'
  | 'webchat'
  | 'whatsapp'
  | 'instagram'
  | 'facebook'
  | 'email'
  | 'phone'
  | 'other';

export type InboxChannelStatus = 'draft' | 'active' | 'inactive' | 'archived';

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

  @Column({ type: 'varchar', length: 80, nullable: true })
  provider!: string | null;

  @Column({ name: 'external_id', type: 'varchar', length: 180, nullable: true })
  externalId!: string | null;

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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
