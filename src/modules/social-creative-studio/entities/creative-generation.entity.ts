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
  CreativeGenerationFailureCode,
  CreativeImageAspectRatio,
  CreativeImageQuality,
  ImageGenerationReferenceRole,
} from '../creative-image-generation.provider';
import type { CreativeGenerationPersistedReferenceSource } from '../creative-generation-references';
import type { CreativeGenerationContextRecord } from '../creative-generation-context';

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

/**
 * CS3.6.2 — where a generation came from. `fresh` = a new intent; a
 * `regeneration` re-runs another generation's intent; a `variation` changes
 * a base image (an output or a Creative Version). Exactly one origin column
 * matches the type (`CK_social_creative_generations_origin`).
 */
export type CreativeGenerationOriginType =
  | 'fresh'
  | 'regeneration'
  | 'variation';

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

  /**
   * Request, frozen at enqueue: the worker runs minutes later, elsewhere.
   * `prompt` is what the operator typed (the intent) — never replaced by the
   * composed text.
   */
  @Column({ type: 'text' }) prompt!: string;
  @Column({ name: 'output_count', type: 'smallint' }) outputCount!: number;
  @Column({ name: 'aspect_ratio', type: 'varchar', length: 8 })
  aspectRatio!: CreativeImageAspectRatio;
  @Column({ type: 'varchar', length: 16 }) quality!: CreativeImageQuality;

  /**
   * CS3.4.1 — the Planner item this generation was made for (NULL =
   * standalone). Resolved in the caller's full scope at enqueue; FK ON DELETE
   * SET NULL like `social_creative_assets.content_item_id`.
   */
  @Column({ name: 'content_item_id', type: 'uuid', nullable: true })
  contentItemId!: string | null;
  /**
   * CS3.4.1 — the exact text sent to the provider: operator intent composed
   * with the resolved context (`composeCreativeImagePrompt`). Frozen at
   * enqueue, so a later Brand Kit or Planner edit never changes what a
   * queued generation sends. Equals `prompt` on rows created before CS3.4.1.
   */
  @Column({ name: 'effective_prompt', type: 'text' })
  effectivePrompt!: string;
  /**
   * CS3.4.1 — references and digests of the context used, no copied text
   * (`CreativeGenerationContextRecord`). NULL on rows created before CS3.4.1.
   */
  @Column({ name: 'generation_context', type: 'jsonb', nullable: true })
  generationContext!: CreativeGenerationContextRecord | null;

  /**
   * CS3.6.2 — provenance of a derived generation (migration 1798500000000).
   * FKs `ON DELETE RESTRICT` to entities that are never deleted; same scope
   * and immutability enforced by `TR_social_creative_generations_origin`.
   * A variation's base bytes are its reference at position 0 (`base`).
   */
  @Column({
    name: 'origin_type',
    type: 'varchar',
    length: 16,
    default: 'fresh',
  })
  originType!: CreativeGenerationOriginType;
  @Column({ name: 'origin_generation_id', type: 'uuid', nullable: true })
  originGenerationId!: string | null;
  @Column({ name: 'origin_output_id', type: 'uuid', nullable: true })
  originOutputId!: string | null;
  @Column({ name: 'origin_version_id', type: 'uuid', nullable: true })
  originVersionId!: string | null;

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

  /**
   * Last failure as a closed code — never provider text. Kept while a retry
   * waits. `reference_unavailable` (CS3.4.2) is the domain's own.
   */
  @Column({ name: 'error_code', type: 'varchar', length: 40, nullable: true })
  errorCode!: CreativeGenerationFailureCode | null;
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

/**
 * CS3.4.2 — one reference image of a generation, frozen at enqueue in the
 * same transaction as the generation. The worker sends exactly these rows, in
 * `position` order ("Image 1..N" of the effective prompt), and never resolves
 * the current Planner or Brand Kit again.
 *
 * Exactly one owner id: `brand_kit_asset_id` for `brand`, `media_asset_id`
 * for `planner`/`operator`/`base`. `base` (CS3.6.2) is a variation's Image 1:
 * the origin output's temporary media or the origin version's durable media. Deliberately NOT foreign keys — provenance must
 * outlive the binary (a later Brand Kit delete or a CS3.6 expiry). What the
 * database enforces instead (migration 1798300000000):
 *   - on insert: owner row exists, in the generation's exact four-part scope,
 *     durable, not deleted, and its mime/size/checksum equal the snapshot;
 *     a `planner` media is a current reference of the generation's item;
 *     the generation is still a fresh `queued` row;
 *   - afterwards: the row is immutable except `dispatch_started_at` (NULL → time once);
 *   - a referenced `media_assets` row cannot be deleted, tombstoned, re-scoped
 *     or have its bytes/key swapped while the generation is pending.
 *
 * `checksum` is the owner's sha256 at enqueue; the worker refuses bytes that
 * do not hash to it. No binary is stored here.
 */
@Entity('social_creative_generation_references')
@Unique('UQ_social_creative_generation_references_position', [
  'generationId',
  'position',
])
export class CreativeGenerationReferenceEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'generation_id', type: 'uuid' }) generationId!: string;
  @Column({ type: 'smallint' }) position!: number;
  @Column({ type: 'varchar', length: 16 })
  source!: CreativeGenerationPersistedReferenceSource;
  @Column({ type: 'varchar', length: 40 }) kind!: string;
  @Column({ type: 'varchar', length: 16 })
  role!: ImageGenerationReferenceRole;
  @Column({ name: 'brand_kit_asset_id', type: 'uuid', nullable: true })
  brandKitAssetId!: string | null;
  @Column({ name: 'media_asset_id', type: 'uuid', nullable: true })
  mediaAssetId!: string | null;
  @Column({ name: 'mime_type', type: 'varchar', length: 32 })
  mimeType!: string;
  @Column({ name: 'byte_size', type: 'bigint' }) byteSize!: string;
  @Column({ type: 'char', length: 64 }) checksum!: string;
  /**
   * First time the worker, with a valid lease and these bytes verified,
   * STARTED a dispatch attempt to the provider (NULL = never started).
   * Not proof of delivery: the provider may never have received, processed,
   * billed or answered it. Write-once; retries keep the first value.
   */
  @Column({ name: 'dispatch_started_at', type: 'timestamptz', nullable: true })
  dispatchStartedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
