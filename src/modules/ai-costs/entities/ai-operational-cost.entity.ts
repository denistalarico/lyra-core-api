import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/** `known` = money recorded; `unknown` = a paid call whose cost Lyra cannot state. */
export type AiCostStatus = 'known' | 'unknown';

/**
 * Where the money of a `known` row came from:
 *   provider_reported  the provider returned money for this operation;
 *   lyra_calculated    provider-reported units × a versioned price table;
 *   estimated          Lyra's own estimate (no source uses it today);
 *   reconciled         set from an external reconciliation (wallet, invoice).
 */
export type AiCostSource =
  | 'provider_reported'
  | 'lyra_calculated'
  | 'estimated'
  | 'reconciled';

/** Why an `unknown` row has no amount. Never "free". */
export type AiCostUnknownReason =
  | 'outcome_unknown'
  | 'usage_missing'
  | 'unpriced';

/** Whether the paid operation produced what was asked. */
export type AiCostOutcome = 'succeeded' | 'failed';

/**
 * CS6-B — one paid AI provider operation, as an economic fact
 * (migration 1799000000000).
 *
 * Provider-neutral on purpose: Finance reads this table (through
 * `AiCostLedgerService`) and never a provider's own tables. The producing
 * domain writes one row per paid operation, keyed by
 * `(source_domain, source_type, source_id)`, so a retry, a recovery or a
 * second reconcile can never record the same operation twice.
 *
 * Economic columns are immutable (trigger `TR_ai_operational_costs_immutable`);
 * an `unknown` row may become `known` exactly once. Correlation columns
 * (`content_item_id`, `project_id`, `task_id`, `correlated_at`) are a
 * projection, rewritten when the producing domain learns a later link. No
 * foreign keys: the cost outlives tasks, projects and content.
 *
 * Amounts stay in the provider's currency. There is no FX in the platform, so
 * no normalized amount is stored (see the CS6-B currency policy).
 */
@Entity('ai_operational_costs')
@Unique('UQ_ai_operational_costs_source', [
  'sourceDomain',
  'sourceType',
  'sourceId',
])
export class AiOperationalCostEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;

  /** Producing domain, e.g. `social.creative_studio`. */
  @Column({ name: 'source_domain', type: 'varchar', length: 60 })
  sourceDomain!: string;
  /** The paid operation inside that domain, e.g. `video_operation`. */
  @Column({ name: 'source_type', type: 'varchar', length: 60 })
  sourceType!: string;
  @Column({ name: 'source_id', type: 'varchar', length: 160 })
  sourceId!: string;
  /**
   * The user-facing unit of work several operations may belong to (one Reel
   * = generate + extensions). Reports count these, not operations.
   */
  @Column({ name: 'logical_type', type: 'varchar', length: 60 })
  logicalType!: string;
  @Column({ name: 'logical_id', type: 'varchar', length: 160 })
  logicalId!: string;
  @Column({ name: 'operation_kind', type: 'varchar', length: 60 })
  operationKind!: string;

  @Column({ type: 'varchar', length: 80 }) provider!: string;
  @Column({ type: 'varchar', length: 160, nullable: true })
  model!: string | null;
  @Column({ type: 'varchar', length: 16 }) outcome!: AiCostOutcome;

  @Column({ name: 'usage_unit', type: 'varchar', length: 80, nullable: true })
  usageUnit!: string | null;
  @Column({
    name: 'usage_quantity',
    type: 'numeric',
    precision: 20,
    scale: 6,
    nullable: true,
  })
  usageQuantity!: string | null;
  /** Raw provider units (tokens…), never prompts or provider text. */
  @Column({ name: 'usage_metrics', type: 'jsonb', nullable: true })
  usageMetrics!: Record<string, number> | null;
  /** Single-rate price; NULL for multi-rate tables (rates in `metadata`). */
  @Column({
    name: 'unit_price',
    type: 'numeric',
    precision: 18,
    scale: 8,
    nullable: true,
  })
  unitPrice!: string | null;
  @Column({
    name: 'pricing_version',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  pricingVersion!: string | null;

  @Column({ name: 'cost_status', type: 'varchar', length: 16 })
  costStatus!: AiCostStatus;
  /** Exact decimal string; NULL when `unknown`. */
  @Column({
    name: 'provider_cost',
    type: 'numeric',
    precision: 18,
    scale: 6,
    nullable: true,
  })
  providerCost!: string | null;
  @Column({
    name: 'provider_currency',
    type: 'char',
    length: 3,
    nullable: true,
  })
  providerCurrency!: string | null;
  @Column({ name: 'cost_source', type: 'varchar', length: 24, nullable: true })
  costSource!: AiCostSource | null;
  @Column({
    name: 'unknown_reason',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  unknownReason!: AiCostUnknownReason | null;

  /** When the paid operation happened: the cost's date for every report. */
  @Column({ name: 'occurred_at', type: 'timestamptz' }) occurredAt!: Date;

  @Column({ name: 'content_item_id', type: 'uuid', nullable: true })
  contentItemId!: string | null;
  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId!: string | null;
  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId!: string | null;
  @Column({ name: 'correlated_at', type: 'timestamptz', nullable: true })
  correlatedAt!: Date | null;

  /** Source-specific audit facts (attempts, origin, rates). No secrets. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
