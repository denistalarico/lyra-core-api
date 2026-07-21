import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type InboxAgentDecisionStatus =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'invalidated'
  | 'failed';

export type InboxAgentDecisionReviewOutcome =
  | 'analysis_approved'
  | 'actions_partially_approved'
  | 'actions_applied'
  | 'decision_rejected';

@Entity('inbox_agent_decisions')
@Index('idx_inbox_decision_scope', [
  'tenantId',
  'workspaceId',
  'conversationId',
])
@Index(
  'uq_inbox_decision_idempotency',
  ['tenantId', 'workspaceId', 'idempotencyKey'],
  { unique: true },
)
export class InboxAgentDecisionEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'conversation_id', type: 'uuid' }) conversationId!: string;
  @Column({ name: 'batch_id', type: 'uuid' }) batchId!: string;
  @Column({ name: 'agent_id', type: 'uuid', nullable: true }) agentId!:
    | string
    | null;
  @Column({ name: 'agent_version_id', type: 'uuid', nullable: true })
  agentVersionId!: string | null;
  @Column({ name: 'ownership_version', type: 'int' }) ownershipVersion!: number;
  @Column({ name: 'schema_version', type: 'int', default: 1 })
  schemaVersion!: number;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 180 })
  idempotencyKey!: string;
  @Column({ name: 'correlation_id', type: 'uuid' }) correlationId!: string;
  @Column({ type: 'varchar', length: 24, default: 'proposed' })
  status!: InboxAgentDecisionStatus;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) proposal!: Record<
    string,
    unknown
  >;
  @Column({
    name: 'policy_result',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  policyResult!: Record<string, unknown>;
  @Column({
    name: 'context_snapshot',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  contextSnapshot!: Record<string, unknown>;
  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode!: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true })
  provider!: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true })
  model!: string | null;
  @Column({
    name: 'prompt_version',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  promptVersion!: string | null;
  @Column({ name: 'prompt_hash', type: 'varchar', length: 128, nullable: true })
  promptHash!: string | null;
  @Column({ name: 'context_version', type: 'int', nullable: true })
  contextVersion!: number | null;
  @Column({ name: 'context_hash', type: 'varchar', length: 64, nullable: true })
  contextHash!: string | null;
  @Column({
    name: 'prompt_layers',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  promptLayers!: Array<Record<string, unknown>>;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  usage!: Record<string, unknown>;
  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs!: number | null;
  @Column({ name: 'action_plan', type: 'jsonb', default: () => "'[]'::jsonb" })
  actionPlan!: Array<Record<string, unknown>>;
  @Column({
    name: 'applied_actions',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  appliedActions!: Array<Record<string, unknown>>;
  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true })
  appliedAt!: Date | null;
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true }) reviewedBy!:
    | string
    | null;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;
  @Column({
    name: 'review_outcome',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  reviewOutcome!: InboxAgentDecisionReviewOutcome | null;
  @Column({
    name: 'reviewed_action_keys',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  reviewedActionKeys!: string[];
  @Column({
    name: 'review_idempotency_key',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  reviewIdempotencyKey!: string | null;
  @Column({
    name: 'review_intent_hash',
    type: 'char',
    length: 64,
    nullable: true,
  })
  reviewIntentHash!: string | null;
  @Column({ name: 'review_response_snapshot', type: 'jsonb', nullable: true })
  reviewResponseSnapshot!: Record<string, unknown> | null;
  @Column({ name: 'review_audit_ref', type: 'uuid', nullable: true })
  reviewAuditRef!: string | null;
  @Column({
    name: 'review_expected_version',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  reviewExpectedVersion!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
