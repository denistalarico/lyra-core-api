import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type InboxConversationStatus =
  | 'new'
  | 'open'
  | 'pending'
  | 'waiting'
  | 'handoff_requested'
  | 'resolved'
  | 'closed'
  | 'archived';

export type InboxConversationPriority = 'low' | 'normal' | 'high' | 'urgent';
export type InboxConversationOwnershipState =
  | 'ai_active'
  | 'handoff_requested'
  | 'human_active'
  | 'paused'
  | 'closed';

@Entity('inbox_conversations')
@Index('idx_inbox_conversations_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_inbox_conversations_channel', ['channelId'])
@Index('idx_inbox_conversations_contact', ['contactId'])
@Index('idx_inbox_conversations_status', ['tenantId', 'workspaceId', 'status'])
@Index('idx_inbox_conversations_assigned_user', [
  'tenantId',
  'workspaceId',
  'assignedUserId',
])
@Index('idx_inbox_conversations_last_message', [
  'tenantId',
  'workspaceId',
  'lastMessageAt',
])
export class InboxConversationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId!: string | null;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ name: 'opportunity_id', type: 'uuid', nullable: true })
  opportunityId!: string | null;

  @Column({
    name: 'external_thread_id',
    type: 'varchar',
    length: 220,
    nullable: true,
  })
  externalThreadId!: string | null;

  @Column({ type: 'varchar', length: 180, nullable: true })
  title!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'new' })
  status!: InboxConversationStatus;

  @Column({ type: 'varchar', length: 24, default: 'normal' })
  priority!: InboxConversationPriority;

  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId!: string | null;

  @Column({ name: 'assigned_agent_id', type: 'uuid', nullable: true })
  assignedAgentId!: string | null;

  @Column({ type: 'varchar', length: 40, default: 'manual' })
  source!: string;

  @Column({
    name: 'business_mode',
    type: 'varchar',
    length: 80,
    default: 'general',
  })
  businessMode!: string;

  @Column({
    name: 'last_message_preview',
    type: 'varchar',
    length: 260,
    nullable: true,
  })
  lastMessagePreview!: string | null;

  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt!: Date | null;

  @Column({ name: 'unread_count', type: 'int', default: 0 })
  unreadCount!: number;

  @Column({ name: 'ai_enabled', type: 'boolean', default: false })
  aiEnabled!: boolean;

  @Column({
    name: 'ownership_state',
    type: 'varchar',
    length: 32,
    default: 'paused',
  })
  ownershipState!: InboxConversationOwnershipState;

  @Column({ name: 'ownership_version', type: 'int', default: 1 })
  ownershipVersion!: number;

  @Column({
    name: 'ownership_reason',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  ownershipReason!: string | null;

  @Column({ name: 'ownership_changed_at', type: 'timestamptz' })
  ownershipChangedAt!: Date;

  @Column({
    name: 'qualification_status',
    type: 'varchar',
    length: 32,
    default: 'pending',
  })
  qualificationStatus!: 'pending' | 'qualified' | 'disqualified' | 'internal';

  @Column({
    name: 'qualification_reason',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  qualificationReason!: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
