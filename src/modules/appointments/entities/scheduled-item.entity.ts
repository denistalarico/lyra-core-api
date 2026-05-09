import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'scheduled_items' })
@Index('idx_scheduled_items_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_scheduled_items_workspace_status', ['workspaceId', 'status'])
@Index('idx_scheduled_items_workspace_type', ['workspaceId', 'type'])
@Index('idx_scheduled_items_workspace_start_at', ['workspaceId', 'startAt'])
@Index('idx_scheduled_items_workspace_due_at', ['workspaceId', 'dueAt'])
@Index('idx_scheduled_items_assigned_user_id', ['assignedUserId'])
@Index('idx_scheduled_items_contact_id', ['contactId'])
export class ScheduledItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: string;

  @Column({ type: 'varchar', length: 32, default: 'scheduled' })
  status!: string;

  @Column({ type: 'varchar', length: 32, default: 'medium' })
  priority!: string;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'start_at', type: 'timestamptz', nullable: true })
  startAt!: Date | null;

  @Column({ name: 'end_at', type: 'timestamptz', nullable: true })
  endAt!: Date | null;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt!: Date | null;

  @Column({ name: 'all_day', type: 'boolean', default: false })
  allDay!: boolean;

  @Column({ type: 'varchar', length: 80, nullable: true })
  timezone!: string | null;

  @Column({ name: 'location_type', type: 'varchar', length: 32, default: 'none' })
  locationType!: string;

  @Column({ name: 'location_text', type: 'text', nullable: true })
  locationText!: string | null;

  @Column({ name: 'video_mode', type: 'varchar', length: 32, nullable: true })
  videoMode!: string | null;

  @Column({ name: 'video_url', type: 'text', nullable: true })
  videoUrl!: string | null;

  @Column({ name: 'phone_url', type: 'text', nullable: true })
  phoneUrl!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'workspace' })
  visibility!: string;

  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId!: string | null;

  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId!: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ name: 'source_channel', type: 'varchar', length: 32, default: 'manual' })
  sourceChannel!: string;

  @Column({ name: 'source_conversation_id', type: 'uuid', nullable: true })
  sourceConversationId!: string | null;

  @Column({ name: 'source_lead_id', type: 'uuid', nullable: true })
  sourceLeadId!: string | null;

  @Column({ name: 'source_opportunity_id', type: 'uuid', nullable: true })
  sourceOpportunityId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
