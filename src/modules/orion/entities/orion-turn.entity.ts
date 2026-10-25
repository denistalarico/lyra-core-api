import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type OrionTurnSurface = 'operations_room' | 'team_chat' | 'client_chat';
export type OrionTurnPrincipal = 'agency' | 'client_area';
export type OrionTurnStatus = 'reserved' | 'succeeded' | 'failed';

/** Tool name and outcome only: arguments and results never reach this row. */
export type OrionToolCallRecord = {
  name: string;
  outcome: 'ok' | 'denied' | 'invalid' | 'error';
};

/**
 * OR4 — one Orion turn that reached (or was about to reach) the LLM
 * (migration 1800700000000).
 *
 * It is both the audit row (§3.5 item 9) and the budget ledger (D-OR-1): the
 * row is inserted as `reserved` before the provider is called, under a
 * per-tenant advisory lock, and the month's spend is the sum of these rows.
 * It never stores the user's text, the answer or tool arguments: tokens, cost,
 * tool names and outcome are what an audit needs, and nothing here is PII.
 *
 * The paid operation is also materialized in `ai_operational_costs`
 * (`source_domain = 'orion'`), the provider-neutral ledger Finance reads.
 */
@Entity('orion_turns')
@Index('UQ_orion_turns_idempotency', ['tenantId', 'userId', 'idempotencyKey'], {
  unique: true,
})
@Index('IDX_orion_turns_tenant_created', ['tenantId', 'createdAt'])
@Index('IDX_orion_turns_user_created', ['tenantId', 'userId', 'createdAt'])
export class OrionTurnEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;

  @Column({ type: 'varchar', length: 16 }) principal!: OrionTurnPrincipal;
  @Column({ type: 'varchar', length: 24 }) surface!: OrionTurnSurface;
  @Column({ type: 'varchar', length: 16 }) status!: OrionTurnStatus;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 80 })
  idempotencyKey!: string;

  @Column({ type: 'varchar', length: 40 }) provider!: string;
  @Column({ type: 'varchar', length: 80 }) model!: string;
  @Column({ name: 'prompt_version', type: 'varchar', length: 40 })
  promptVersion!: string;

  @Column({
    name: 'reserved_cost_usd',
    type: 'numeric',
    precision: 12,
    scale: 6,
  })
  reservedCostUsd!: string;
  @Column({
    name: 'estimated_cost_usd',
    type: 'numeric',
    precision: 12,
    scale: 6,
    nullable: true,
  })
  estimatedCostUsd!: string | null;

  @Column({ name: 'input_tokens', type: 'int', nullable: true })
  inputTokens!: number | null;
  @Column({ name: 'cached_input_tokens', type: 'int', nullable: true })
  cachedInputTokens!: number | null;
  @Column({ name: 'output_tokens', type: 'int', nullable: true })
  outputTokens!: number | null;

  @Column({ name: 'tool_calls', type: 'jsonb', default: () => "'[]'::jsonb" })
  toolCalls!: OrionToolCallRecord[];
  @Column({ type: 'int', default: 0 }) rounds!: number;
  @Column({ type: 'int', default: 0 }) attempts!: number;
  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs!: number | null;
  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
