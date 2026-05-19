import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AgencySalesItemType =
  | 'service'
  | 'plan'
  | 'setup'
  | 'addon'
  | 'product'
  | 'custom';

export type AgencySalesItemBillingType =
  | 'one_time'
  | 'recurring'
  | 'setup_plus_recurring';

export type AgencySalesItemStatus = 'active' | 'inactive' | 'archived';

export type AgencySalesPipelineStatus = 'active' | 'inactive' | 'archived';

export type AgencySalesStageType =
  | 'new'
  | 'qualified'
  | 'proposal'
  | 'negotiation'
  | 'won'
  | 'lost'
  | 'archived';

export type AgencySalesOpportunityStatus =
  | 'open'
  | 'won'
  | 'lost'
  | 'archived';

@Entity('agency_sales_items')
@Index('idx_agency_sales_items_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_agency_sales_items_status', ['tenantId', 'workspaceId', 'status'])
export class AgencySalesItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'service' })
  type!: AgencySalesItemType;

  @Column({ type: 'varchar', length: 40, nullable: true })
  category!: string | null;

  @Column({ name: 'billing_type', type: 'varchar', length: 30, default: 'one_time' })
  billingType!: AgencySalesItemBillingType;

  @Column({ name: 'currency', type: 'varchar', length: 10, default: 'BRL' })
  currency!: string;

  @Column({ name: 'unit_price_cents', type: 'int', default: 0 })
  unitPriceCents!: number;

  @Column({ name: 'setup_price_cents', type: 'int', default: 0 })
  setupPriceCents!: number;

  @Column({ name: 'recurring_price_cents', type: 'int', default: 0 })
  recurringPriceCents!: number;

  @Column({ name: 'recurrence_interval', type: 'varchar', length: 20, nullable: true })
  recurrenceInterval!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status!: AgencySalesItemStatus;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('agency_sales_pipelines')
@Index('idx_agency_sales_pipelines_tenant_workspace', ['tenantId', 'workspaceId'])
export class AgencySalesPipelineEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status!: AgencySalesPipelineStatus;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ type: 'int', default: 0 })
  position!: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('agency_sales_stages')
@Index('idx_agency_sales_stages_pipeline', ['pipelineId'])
@Index('idx_agency_sales_stages_tenant_workspace', ['tenantId', 'workspaceId'])
export class AgencySalesStageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'pipeline_id', type: 'uuid' })
  pipelineId!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 30, default: 'new' })
  type!: AgencySalesStageType;

  @Column({ type: 'int', default: 0 })
  position!: number;

  @Column({ name: 'probability', type: 'int', default: 0 })
  probability!: number;

  @Column({ name: 'is_closed', type: 'boolean', default: false })
  isClosed!: boolean;

  @Column({ name: 'is_won', type: 'boolean', default: false })
  isWon!: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('agency_sales_opportunities')
@Index('idx_agency_sales_opportunities_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_agency_sales_opportunities_pipeline_stage', ['pipelineId', 'stageId'])
@Index('idx_agency_sales_opportunities_contact', ['contactId'])
export class AgencySalesOpportunityEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 160 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'pipeline_id', type: 'uuid' })
  pipelineId!: string;

  @Column({ name: 'stage_id', type: 'uuid' })
  stageId!: string;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ name: 'company_contact_id', type: 'uuid', nullable: true })
  companyContactId!: string | null;

  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId!: string | null;

  @Column({ name: 'amount_cents', type: 'int', default: 0 })
  amountCents!: number;

  @Column({ name: 'recurring_amount_cents', type: 'int', default: 0 })
  recurringAmountCents!: number;

  @Column({ type: 'varchar', length: 10, default: 'BRL' })
  currency!: string;

  @Column({ type: 'varchar', length: 30, default: 'open' })
  status!: AgencySalesOpportunityStatus;

  @Column({ name: 'expected_close_date', type: 'date', nullable: true })
  expectedCloseDate!: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @Column({ name: 'lost_reason', type: 'varchar', length: 160, nullable: true })
  lostReason!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}


@Entity('agency_sales_opportunity_items')
@Index('idx_agency_sales_opportunity_items_opportunity', ['opportunityId'])
@Index('idx_agency_sales_opportunity_items_tenant_workspace', ['tenantId', 'workspaceId'])
export class AgencySalesOpportunityItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'opportunity_id', type: 'uuid' })
  opportunityId!: string;

  @Column({ name: 'sales_item_id', type: 'uuid', nullable: true })
  salesItemId!: string | null;

  @Column({ type: 'varchar', length: 140 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'service' })
  type!: AgencySalesItemType;

  @Column({ type: 'varchar', length: 40, nullable: true })
  category!: string | null;

  @Column({ name: 'billing_type', type: 'varchar', length: 30, default: 'one_time' })
  billingType!: AgencySalesItemBillingType;

  @Column({ type: 'varchar', length: 10, default: 'BRL' })
  currency!: string;

  @Column({ type: 'int', default: 1 })
  quantity!: number;

  @Column({ name: 'unit_price_cents', type: 'int', default: 0 })
  unitPriceCents!: number;

  @Column({ name: 'setup_price_cents', type: 'int', default: 0 })
  setupPriceCents!: number;

  @Column({ name: 'recurring_price_cents', type: 'int', default: 0 })
  recurringPriceCents!: number;

  @Column({ name: 'subtotal_cents', type: 'int', default: 0 })
  subtotalCents!: number;

  @Column({ name: 'recurring_subtotal_cents', type: 'int', default: 0 })
  recurringSubtotalCents!: number;

  @Column({ name: 'recurrence_interval', type: 'varchar', length: 20, nullable: true })
  recurrenceInterval!: string | null;

  @Column({ type: 'int', default: 0 })
  position!: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}


export type AgencySalesActivityType =
  | 'follow_up'
  | 'meeting'
  | 'call'
  | 'task'
  | 'email'
  | 'whatsapp'
  | 'note';

export type AgencySalesActivityStatus =
  | 'pending'
  | 'done'
  | 'canceled';

@Entity('agency_sales_activities')
@Index('idx_agency_sales_activities_opportunity', ['opportunityId'])
@Index('idx_agency_sales_activities_tenant_workspace', ['tenantId', 'workspaceId'])
@Index('idx_agency_sales_activities_due_at', ['tenantId', 'workspaceId', 'dueAt'])
@Index('idx_agency_sales_activities_assigned_user', ['assignedUserId'])
export class AgencySalesActivityEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'opportunity_id', type: 'uuid' })
  opportunityId!: string;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'follow_up' })
  type!: AgencySalesActivityType;

  @Column({ type: 'varchar', length: 30, default: 'pending' })
  status!: AgencySalesActivityStatus;

  @Column({ type: 'varchar', length: 160 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'completed_by_user_id', type: 'uuid', nullable: true })
  completedByUserId!: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  outcome!: string | null;

  @Column({ type: 'int', default: 0 })
  position!: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
