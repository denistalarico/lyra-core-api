import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const LEADFLOW_OPERATIONS_ACTION_INTENTS = [
  'update_offer_price',
  'schedule_discount',
  'add_closure',
  'update_business_hours',
  'capacity_unavailable',
  'capacity_released',
] as const;

export type LeadFlowOperationsActionIntent =
  (typeof LEADFLOW_OPERATIONS_ACTION_INTENTS)[number];

export const LEADFLOW_OPERATIONS_ACTION_STATUSES = [
  'pending_confirmation',
  'confirmed',
  'cancelled',
] as const;

export type LeadFlowOperationsActionStatus =
  (typeof LEADFLOW_OPERATIONS_ACTION_STATUSES)[number];

@Index('IDX_lf_ops_actions_context_created', [
  'tenantId',
  'workspaceId',
  'settingsId',
  'createdAt',
])
@Index('IDX_lf_ops_actions_context_status', [
  'tenantId',
  'workspaceId',
  'settingsId',
  'status',
])
@Entity('leadflow_operations_actions')
export class LeadFlowOperationsActionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'settings_id', type: 'uuid' })
  settingsId!: string;

  @Column({ name: 'business_mode_key', type: 'varchar', length: 80 })
  businessModeKey!: string;

  @Column({ type: 'varchar', length: 60 })
  intent!: LeadFlowOperationsActionIntent;

  @Column({ type: 'varchar', length: 30 })
  status!: LeadFlowOperationsActionStatus;

  @Column({ name: 'request_text', type: 'text' })
  requestText!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  preview!: Record<string, unknown>;

  @Column({
    name: 'resource_key',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  resourceKey!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  timezone!: string | null;

  @Column({ name: 'effective_from', type: 'timestamptz', nullable: true })
  effectiveFrom!: Date | null;

  @Column({ name: 'effective_until', type: 'timestamptz', nullable: true })
  effectiveUntil!: Date | null;

  @Column({
    name: 'validation_issues',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  validationIssues!: string[];

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  idempotencyKey!: string | null;

  @Column({ type: 'integer', default: 1 })
  revision!: number;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'confirmed_by_id', type: 'uuid', nullable: true })
  confirmedById!: string | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ name: 'cancelled_by_id', type: 'uuid', nullable: true })
  cancelledById!: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
