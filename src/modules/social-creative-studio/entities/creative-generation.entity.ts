import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type {
  CreativeImageAspectRatio,
  CreativeImageQuality,
  ImageGenerationFailureCode,
} from '../creative-image-generation.provider';

/**
 * CS3.2 — the generation's own lifecycle. Not Approvals' and not the Creative
 * Asset's: a generation never becomes a creative by itself.
 *
 *   queued ──claim──▶ processing ──▶ completed
 *     ▲                   │
 *     └──retryable, attempts left┘──▶ failed (terminal)
 *
 * A retry goes straight back to `queued` with a later `available_at`; there is
 * no separate `retrying` state because nothing behaves differently in it.
 */
export type CreativeGenerationStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

export type CreativeGenerationType = 'image';

/** How an output became durable; `revision` is the CS2B.6 loop. */
export type CreativeGenerationPromotionKind =
  | 'new_asset'
  | 'version'
  | 'revision';

/**
 * CS3.2 — one AI generation request, and the job that executes it.
 *
 * The row IS the queue entry (same Postgres-backed claim loop as Planner copy
 * generation and the S2.5 ad sync): there is no second system to enqueue
 * into, so "job without record" and "record whose enqueue failed" cannot
 * exist. Scope is the full CC2C four-part scope with the composite company
 * FK, taken from the request context at enqueue and never from the body.
 *
 * Provider/model/usage/cost are recorded for CS6 and never reach the UI.
 */
@Entity('social_creative_generations')
@Index('IDX_social_creative_generations_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
  'createdAt',
])
@Check(
  'CK_social_creative_generations_company_scope',
  '"company_context_id" IS NULL OR "agency_client_id" IS NOT NULL',
)
export class CreativeGenerationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;
  @Column({ name: 'generation_type', type: 'varchar', length: 16 })
  generationType!: CreativeGenerationType;
  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status!: CreativeGenerationStatus;

  /** Request, frozen at enqueue: the worker runs minutes later, elsewhere. */
  @Column({ type: 'text' }) prompt!: string;
  @Column({ name: 'output_count', type: 'smallint' }) outputCount!: number;
  @Column({ name: 'aspect_ratio', type: 'varchar', length: 8 })
  aspectRatio!: CreativeImageAspectRatio;
  @Column({ type: 'varchar', length: 16 }) quality!: CreativeImageQuality;

  /**
   * CS3.2.1 — the client's `Idempotency-Key` and the sha256 of the normalized
   * request. Unique per four-part scope and `generation_type` through the
   * expression index `UQ_social_creative_generations_idempotency` (migration
   * 1798000000000; COALESCE on the nullable scope parts, so it is not declared
   * here). NULL only on rows created before CS3.2.1.
   */
  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  idempotencyKey!: string | null;
  @Column({
    name: 'request_fingerprint',
    type: 'char',
    length: 64,
    nullable: true,
  })
  requestFingerprint!: string | null;

  /** Queue mechanics. `locked_by` is set exactly while `processing`. */
  @Column({ type: 'smallint', default: 0 }) attempts!: number;
  @Column({ name: 'max_attempts', type: 'smallint' }) maxAttempts!: number;
  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt!: Date;
  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;
  @Column({ name: 'locked_by', type: 'varchar', length: 120, nullable: true })
  lockedBy!: string | null;

  /** Last failure as a port code — never provider text. Kept while a retry waits. */
  @Column({ name: 'error_code', type: 'varchar', length: 40, nullable: true })
  errorCode!: ImageGenerationFailureCode | null;
  @Column({ name: 'error_retryable', type: 'boolean', nullable: true })
  errorRetryable!: boolean | null;

  /** Provenance and usage (CS6). NULL until a provider call returns. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  provider!: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true })
  model!: string | null;
  /** Provider-reported units, summed over every paid attempt. */
  @Column({ name: 'usage_metrics', type: 'jsonb', nullable: true })
  usageMetrics!: Record<string, number> | null;
  /** Exact decimal (string), summed over every paid attempt. */
  @Column({
    name: 'cost_amount',
    type: 'numeric',
    precision: 18,
    scale: 6,
    nullable: true,
  })
  costAmount!: string | null;
  @Column({ name: 'cost_currency', type: 'char', length: 3, nullable: true })
  costCurrency!: string | null;

  @Column({ name: 'requested_by_id', type: 'uuid', nullable: true })
  requestedById!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;
}

/**
 * CS3.2 — one output of a generation: the link between the generation and the
 * temporary `media_asset` that owns the binary (no storage metadata is
 * duplicated here), and — once chosen — the Creative Version it became.
 *
 * `media_asset_id` goes NULL when lifecycle cleanup removes the temporary
 * binary (FK `ON DELETE SET NULL`); the output row, and with it the
 * Version ← Output ← Generation provenance, survives.
 *
 * `promoted_version_id` is written by a compare-and-set inside the same
 * transaction that creates the version, so an output is promoted at most once
 * even under double clicks; UNIQUE keeps one version from claiming two outputs.
 */
@Entity('social_creative_generation_outputs')
@Unique('UQ_social_creative_generation_outputs_index', [
  'generationId',
  'outputIndex',
])
@Unique('UQ_social_creative_generation_outputs_media', ['mediaAssetId'])
@Unique('UQ_social_creative_generation_outputs_version', ['promotedVersionId'])
@Index('IDX_social_creative_generation_outputs_promoted_asset', [
  'promotedCreativeAssetId',
])
export class CreativeGenerationOutputEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'generation_id', type: 'uuid' }) generationId!: string;
  @Column({ name: 'output_index', type: 'smallint' }) outputIndex!: number;
  @Column({ name: 'media_asset_id', type: 'uuid', nullable: true })
  mediaAssetId!: string | null;
  @Column({
    name: 'promotion_kind',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  promotionKind!: CreativeGenerationPromotionKind | null;
  @Column({ name: 'promoted_creative_asset_id', type: 'uuid', nullable: true })
  promotedCreativeAssetId!: string | null;
  @Column({ name: 'promoted_version_id', type: 'uuid', nullable: true })
  promotedVersionId!: string | null;
  @Column({ name: 'promoted_by_id', type: 'uuid', nullable: true })
  promotedById!: string | null;
  @Column({ name: 'promoted_at', type: 'timestamptz', nullable: true })
  promotedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
