import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Status of one copy generation attempt (Planner E8).
 *
 * The vocabulary is the briefing extraction job's
 * (`LeadFlowBriefingJobStatus`) rather than a new one: the claim loop, the
 * retry rule and the dead-letter rule are the same mechanics, and two
 * different spellings of the same lifecycle would be two places to get the
 * worker's transition table wrong.
 */
export type SocialCopyGenerationRunStatus =
  | 'queued'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'dead_letter';

/**
 * What the operator asked to generate. One run covers one content item, so a
 * plan-wide or selection request fans out into one run per item — that is what
 * lets a single item be retried, cancelled or reviewed on its own.
 */
export type SocialCopyGenerationRunKind =
  | 'content_copy'
  | 'plan_copy'
  | 'selection_copy';

/**
 * The Generation Run the Planner blueprint (§8.5) asks for, and the concrete
 * row that `social_content_revisions.generation_run_id` was left pointing at
 * with no physical FK.
 *
 * WHY THE PLANNER OWNS THIS TABLE
 * -------------------------------
 * The E8 audit found no shared Intelligence Layer generation-run persistence to
 * bind to: `common/intelligence` is analytics and benchmark contracts (types and
 * pure functions, no provider call anywhere), the `leadflow_intelligence_*`
 * tables are LeadFlow recommendation rows, and no command bus exists in this
 * service. So the choice was not "reuse or duplicate" but "create the contract
 * or leave E8 blocked". It is created here, named for what it actually is
 * (Planner copy generation) rather than claiming to be a platform-wide layer
 * that nothing else yet uses — the Planner still depends on a provider-agnostic
 * seam (`SocialCopyGenerationProvider`), which is the part §8.5 actually
 * requires. A future shared layer can adopt these rows; nothing here encodes a
 * provider or model name in its schema.
 *
 * WHY PROVENANCE COLUMNS ARE NOT JSONB
 * ------------------------------------
 * `provider`, `model`, `prompt_version` and the token counts are each named in
 * §8.5 and are all things someone will filter or sum by — cost per client
 * (§8.6) is a SUM over `cost_cents` grouped by scope. Buried in a metadata blob
 * they would be unqueryable without a migration later.
 *
 * NO FK TO THE REVISION, AND NONE BACK
 * ------------------------------------
 * A run exists before any revision does, and a run that the operator never
 * accepts never produces one. The revision points at the run (already, and
 * still without a physical FK, because the column predates this table and
 * backfilling an FK onto historical rows is not this etapa's business).
 */
@Entity('social_copy_generation_runs')
@Index('IDX_social_copy_generation_runs_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
@Index('IDX_social_copy_generation_runs_content', [
  'contentItemId',
  'createdAt',
])
@Index('IDX_social_copy_generation_runs_claim', [
  'status',
  'availableAt',
  'lockedAt',
])
export class SocialCopyGenerationRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @Column({ name: 'content_item_id', type: 'uuid' })
  contentItemId!: string;

  @Column({
    name: 'run_kind',
    type: 'varchar',
    length: 40,
    default: 'content_copy',
  })
  runKind!: SocialCopyGenerationRunKind;

  /**
   * Stable per (content item, in-flight request), so a double-clicked button
   * joins the run already queued instead of paying for a second one. Unique
   * within the scope; a new attempt after a terminal run gets a new suffix.
   */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 180 })
  idempotencyKey!: string;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status!: SocialCopyGenerationRunStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'max_attempts', type: 'int', default: 3 })
  maxAttempts!: number;

  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt!: Date;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'locked_by', type: 'varchar', length: 120, nullable: true })
  lockedBy!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: 'dead_lettered_at', type: 'timestamptz', nullable: true })
  deadLetteredAt!: Date | null;

  /**
   * A short safe code, never a provider message. §3 of the E8 handoff forbids
   * rendering backend/provider errors literally, and the surest way to honour
   * that is for the raw text never to be persisted in the first place.
   */
  @Column({ name: 'last_error', type: 'varchar', length: 120, nullable: true })
  lastError!: string | null;

  /** Provenance (§8.5). NULL until a provider call actually returns. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  provider!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  model!: string | null;

  @Column({
    name: 'prompt_version',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  promptVersion!: string | null;

  /**
   * Which editorial inputs the prompt was built from. Bumped when the context
   * builder changes what it sends, so an old run's output stays explainable.
   */
  @Column({
    name: 'context_version',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  contextVersion!: string | null;

  @Column({ name: 'input_tokens', type: 'int', nullable: true })
  inputTokens!: number | null;

  @Column({ name: 'cached_input_tokens', type: 'int', nullable: true })
  cachedInputTokens!: number | null;

  @Column({ name: 'output_tokens', type: 'int', nullable: true })
  outputTokens!: number | null;

  /**
   * Cost in cents (§8.6), so client profitability can sum it per scope.
   *
   * Integer cents, not a float: this is money that gets added up. It holds the
   * reserve while the run is in flight and the estimate afterwards — the view
   * says which, via `costIsEstimated`, because a token-derived number is not a
   * provider invoice and must not be presented as one.
   */
  @Column({ name: 'cost_cents', type: 'int', nullable: true })
  costCents!: number | null;

  @Column({ name: 'cost_is_estimated', type: 'boolean', default: true })
  costIsEstimated!: boolean;

  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs!: number | null;

  /**
   * Fields the requester explicitly asked for, as the contract's camelCase
   * names. NULL means "decide from the item's own state when the prompt is
   * built", which is the default and the reason this is nullable rather than an
   * empty array: an empty array would be a request for nothing.
   */
  @Column({ name: 'requested_fields', type: 'jsonb', nullable: true })
  requestedFields!: string[] | null;

  /**
   * The operator's free-text steer. Persisted because the worker builds the
   * prompt minutes later in a different process, and it is the one input only
   * the requester could supply. Length-capped by the DTO so it cannot become a
   * channel for smuggling a large payload into a prompt.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  instruction!: string | null;

  @Column({ name: 'requested_by_id', type: 'uuid', nullable: true })
  requestedById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
