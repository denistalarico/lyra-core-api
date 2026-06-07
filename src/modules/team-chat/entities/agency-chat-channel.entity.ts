import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  TeamChatChannelKind,
  TeamChatChannelStatus,
  TeamChatChannelVisibility,
} from '../enums';

@Entity('agency_chat_channels')
@Index(['tenantId', 'workspaceId'])
@Index(['tenantId', 'workspaceId', 'kind'])
@Index(['tenantId', 'workspaceId', 'status'])
export class AgencyChatChannel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({
    type: 'enum',
    enum: TeamChatChannelKind,
    default: TeamChatChannelKind.CHANNEL,
  })
  kind!: TeamChatChannelKind;

  @Column({
    type: 'enum',
    enum: TeamChatChannelVisibility,
    default: TeamChatChannelVisibility.PRIVATE,
  })
  visibility!: TeamChatChannelVisibility;

  @Column({
    type: 'enum',
    enum: TeamChatChannelStatus,
    default: TeamChatChannelStatus.ACTIVE,
  })
  status!: TeamChatChannelStatus;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ type: 'varchar', length: 180, nullable: true })
  slug!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'related_client_id', type: 'uuid', nullable: true })
  relatedClientId!: string | null;

  @Column({ name: 'related_project_id', type: 'uuid', nullable: true })
  relatedProjectId!: string | null;

  @Column({ name: 'related_task_id', type: 'uuid', nullable: true })
  relatedTaskId!: string | null;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
