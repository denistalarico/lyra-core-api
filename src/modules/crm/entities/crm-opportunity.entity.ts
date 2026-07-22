import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('crm_opportunities')
export class CrmOpportunityEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'pipeline_id', type: 'uuid' })
  pipelineId!: string;

  @Column({ name: 'stage_id', type: 'uuid' })
  stageId!: string;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({
    name: 'contact_name',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  contactName!: string | null;

  @Column({
    name: 'contact_email',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  contactEmail!: string | null;

  @Column({
    name: 'contact_phone',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  contactPhone!: string | null;

  @Column({ name: 'inbox_conversation_id', type: 'uuid', nullable: true })
  inboxConversationId!: string | null;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({
    name: 'value_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  valueAmount!: string | null;

  @Column({ type: 'varchar', length: 12, default: 'BRL' })
  currency!: string;

  @Column({ type: 'varchar', length: 32, default: 'open' })
  status!: string;

  @Column({ type: 'varchar', length: 24, default: 'normal' })
  priority!: string;

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
    name: 'operational_status',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  operationalStatus!: string | null;

  @Column({
    name: 'business_context',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  businessContext!: Record<string, unknown>;

  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId!: string | null;

  @Column({ name: 'expected_close_date', type: 'date', nullable: true })
  expectedCloseDate!: string | null;

  @Column({ name: 'next_follow_up_at', type: 'timestamptz', nullable: true })
  nextFollowUpAt!: Date | null;

  @Column({ name: 'last_activity_at', type: 'timestamptz', nullable: true })
  lastActivityAt!: Date | null;

  @Column({ name: 'won_at', type: 'timestamptz', nullable: true })
  wonAt!: Date | null;

  @Column({ name: 'lost_at', type: 'timestamptz', nullable: true })
  lostAt!: Date | null;

  @Column({ name: 'lost_reason', type: 'text', nullable: true })
  lostReason!: string | null;

  @Column({ name: 'card_color', type: 'varchar', length: 32, nullable: true })
  cardColor!: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'varchar', length: 32, default: 'workspace' })
  visibility!: string;

  @Column({
    name: 'follow_mode',
    type: 'varchar',
    length: 32,
    default: 'automatic',
  })
  followMode!: string;

  @Column({ name: 'follow_message', type: 'text', nullable: true })
  followMessage!: string | null;

  @Column({
    name: 'follow_send_automatically',
    type: 'boolean',
    default: false,
  })
  followSendAutomatically!: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'row_version', type: 'int', default: 1 })
  rowVersion!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
