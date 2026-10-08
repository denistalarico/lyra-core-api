import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type {
  CreativeVideoAspectRatio,
  CreativeVideoInputKind,
  CreativeVideoMode,
  CreativeVideoOperationKind,
  CreativeVideoQuality,
  VideoGenerationFailureCode,
} from '../creative-video-generation.provider';
import type { CreativeVideoCostSource } from '../creative-video-pricing';
import type { CreativeGenerationReferenceSource } from '../creative-generation-references';
import type { CreativeGenerationPromotionKind } from './creative-generation.entity';

/** Public lifecycle (same four states as image generation; nothing provider-specific). */
export type CreativeVideoGenerationStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

/**
 * Lifecycle of ONE provider job:
 *
 *   pending ──stamp──▶ submitting ──answer──▶ submitted ──▶ succeeded
 *      ▲                  │   │                    └──────▶ failed
 *      └── proven absent ─┘   └── answer lost: stays submitting until
 *                                 recovery finds the job (→ submitted)
 *                                 or proves it absent (→ pending)
 */
export type CreativeVideoOperationStatus =
  | 'pending'
  | 'submitting'
  | 'submitted'
  | 'succeeded'
  | 'failed';

export type CreativeVideoReferencePurpose =
  | 'start_frame'
  | 'reference'
  | 'background';

/**
 * CS4-B — one Reel generation request and the job that drives it
 * (migration 1798600000000). Scope is the full four-part scope taken from the
 * request context; provider/model/job/cost columns are internal (CS6) and
 * never reach the public view.
 *
 * One output only: `output_media_asset_id` (temporary video) and
 * `poster_media_asset_id` (provider cover, when offered), both `SET NULL` so
 * lifecycle cleanup keeps the provenance. Promotion is the CAS on
 * `promoted_version_id`, inside the version's transaction (same as images).
 */
@Entity('social_creative_video_generations')
export class CreativeVideoGenerationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;

  @Column({ type: 'varchar', length: 24 }) mode!: CreativeVideoMode;
  @Column({ name: 'input_kind', type: 'varchar', length: 16 })
  inputKind!: CreativeVideoInputKind;
  @Column({ type: 'varchar', length: 16, default: 'queued' })
  status!: CreativeVideoGenerationStatus;

  /** Generative: the operator's intent, never rewritten. */
  @Column({ type: 'text', nullable: true }) prompt!: string | null;
  /** UGC: the exact words spoken, frozen at enqueue (override or Planner). */
  @Column({ type: 'text', nullable: true }) script!: string | null;
  @Column({
    name: 'script_source',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  scriptSource!: 'operator' | 'planner' | null;
  @Column({ name: 'content_item_id', type: 'uuid', nullable: true })
  contentItemId!: string | null;
  /** Lyra's own catalog row (`social_creative_video_avatars`), never a provider id. */
  @Column({ name: 'avatar_id', type: 'uuid', nullable: true })
  avatarId!: string | null;
  @Column({ type: 'varchar', length: 16, nullable: true })
  language!: string | null;
  /** Generative: text composed with Brand Kit/Planner context and sent. */
  @Column({ name: 'effective_prompt', type: 'text', nullable: true })
  effectivePrompt!: string | null;
  @Column({ name: 'generation_context', type: 'jsonb', nullable: true })
  generationContext!: Record<string, unknown> | null;

  @Column({
    name: 'duration_requested_seconds',
    type: 'smallint',
    nullable: true,
  })
  durationRequestedSeconds!: number | null;
  /** Measured from the stored bytes (or provider-reported); numeric → string. */
  @Column({
    name: 'duration_actual_seconds',
    type: 'numeric',
    precision: 8,
    scale: 3,
    nullable: true,
  })
  durationActualSeconds!: string | null;
  @Column({ name: 'aspect_ratio', type: 'varchar', length: 8 })
  aspectRatio!: CreativeVideoAspectRatio;
  @Column({ type: 'varchar', length: 16 }) quality!: CreativeVideoQuality;
  @Column({ name: 'audio_requested', type: 'boolean', default: false })
  audioRequested!: boolean;
  @Column({ name: 'has_audio', type: 'boolean', nullable: true })
  hasAudio!: boolean | null;

  /** Routing decision, frozen at enqueue. */
  @Column({ type: 'varchar', length: 80 }) provider!: string;
  @Column({
    name: 'provider_model',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  providerModel!: string | null;
  /** Initial operation's job id, copied for lookups; write-once by trigger. */
  @Column({
    name: 'provider_job_id',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  providerJobId!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 180 })
  idempotencyKey!: string;
  @Column({ name: 'request_fingerprint', type: 'char', length: 64 })
  requestFingerprint!: string;

  @Column({ name: 'transient_failures', type: 'smallint', default: 0 })
  transientFailures!: number;
  @Column({ name: 'max_step_retries', type: 'smallint' })
  maxStepRetries!: number;
  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt!: Date;
  @Column({ name: 'deadline_at', type: 'timestamptz' }) deadlineAt!: Date;
  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;
  @Column({ name: 'locked_by', type: 'varchar', length: 120, nullable: true })
  lockedBy!: string | null;

  @Column({ name: 'error_code', type: 'varchar', length: 40, nullable: true })
  errorCode!: VideoGenerationFailureCode | null;
  @Column({ name: 'error_retryable', type: 'boolean', nullable: true })
  errorRetryable!: boolean | null;

  /** Sum of the operations' costs (the ledger is the breakdown). */
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

  @Column({ name: 'output_media_asset_id', type: 'uuid', nullable: true })
  outputMediaAssetId!: string | null;
  @Column({ name: 'poster_media_asset_id', type: 'uuid', nullable: true })
  posterMediaAssetId!: string | null;
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

  @Column({ name: 'requested_by_id', type: 'uuid', nullable: true })
  requestedById!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;
  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;
}

/**
 * CS4-B — one paid provider job of a generation: the provenance and cost
 * ledger. `sequence` 0 is the generation; 1.. are native extensions, each
 * continuing the previous operation's output. Terminal rows are immutable.
 */
@Entity('social_creative_video_generation_operations')
@Unique('UQ_social_creative_video_operations_sequence', [
  'generationId',
  'sequence',
])
export class CreativeVideoOperationEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'generation_id', type: 'uuid' }) generationId!: string;
  @Column({ type: 'smallint' }) sequence!: number;
  @Column({ type: 'varchar', length: 16 }) kind!: CreativeVideoOperationKind;
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: CreativeVideoOperationStatus;
  /** Planned seconds (generate) or seconds added (extend); NULL for UGC. */
  @Column({ name: 'duration_seconds', type: 'smallint', nullable: true })
  durationSeconds!: number | null;
  @Column({ type: 'varchar', length: 80 }) provider!: string;
  @Column({
    name: 'provider_model',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  providerModel!: string | null;
  @Column({
    name: 'provider_operation',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  providerOperation!: string | null;
  @Column({ type: 'varchar', length: 16, nullable: true })
  resolution!: string | null;
  /** Key of the CURRENT submit attempt (idempotency/payload marker). */
  @Column({
    name: 'dispatch_key',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  dispatchKey!: string | null;
  @Column({ name: 'submit_attempts', type: 'smallint', default: 0 })
  submitAttempts!: number;
  /** Current attempt STARTED (request may never have arrived). */
  @Column({ name: 'dispatch_started_at', type: 'timestamptz', nullable: true })
  dispatchStartedAt!: Date | null;
  /** The provider answered with a job id. */
  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;
  @Column({
    name: 'provider_job_id',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  providerJobId!: string | null;
  @Column({
    name: 'provider_output_ref',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  providerOutputRef!: string | null;
  @Column({
    name: 'output_duration_seconds',
    type: 'numeric',
    precision: 8,
    scale: 3,
    nullable: true,
  })
  outputDurationSeconds!: string | null;
  @Column({ name: 'usage_metrics', type: 'jsonb', nullable: true })
  usageMetrics!: Record<string, number> | null;
  @Column({
    name: 'billed_units',
    type: 'numeric',
    precision: 18,
    scale: 3,
    nullable: true,
  })
  billedUnits!: string | null;
  @Column({ name: 'unit_kind', type: 'varchar', length: 80, nullable: true })
  unitKind!: string | null;
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
  @Column({ name: 'cost_source', type: 'varchar', length: 24, nullable: true })
  costSource!: CreativeVideoCostSource | null;
  @Column({ name: 'error_code', type: 'varchar', length: 40, nullable: true })
  errorCode!: VideoGenerationFailureCode | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** CS4-B — a reference image frozen at enqueue (owner id + checksum, no binary). */
@Entity('social_creative_video_generation_references')
@Unique('UQ_social_creative_video_references_position', [
  'generationId',
  'position',
])
export class CreativeVideoReferenceEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'generation_id', type: 'uuid' }) generationId!: string;
  @Column({ type: 'smallint' }) position!: number;
  @Column({ type: 'varchar', length: 16 })
  purpose!: CreativeVideoReferencePurpose;
  @Column({ type: 'varchar', length: 16 })
  source!: CreativeGenerationReferenceSource;
  @Column({ type: 'varchar', length: 40 }) kind!: string;
  @Column({ name: 'brand_kit_asset_id', type: 'uuid', nullable: true })
  brandKitAssetId!: string | null;
  @Column({ name: 'media_asset_id', type: 'uuid', nullable: true })
  mediaAssetId!: string | null;
  @Column({ name: 'mime_type', type: 'varchar', length: 32 }) mimeType!: string;
  @Column({ name: 'byte_size', type: 'bigint' }) byteSize!: string;
  @Column({ type: 'char', length: 64 }) checksum!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * CS4-B — Lyra's projection of the avatars UGC may use. Global preset looks
 * of the platform's provider account (no tenant owns them); the provider ids
 * stay internal and the binary is never copied — previews are proxied.
 */
@Entity('social_creative_video_avatars')
@Unique('UQ_social_creative_video_avatars_provider', [
  'provider',
  'providerAvatarId',
])
export class CreativeVideoAvatarEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar', length: 80 }) provider!: string;
  @Column({ name: 'provider_avatar_id', type: 'varchar', length: 160 })
  providerAvatarId!: string;
  @Column({ type: 'varchar', length: 160 }) name!: string;
  @Column({ name: 'avatar_type', type: 'varchar', length: 40 })
  avatarType!: string;
  @Column({ type: 'varchar', length: 20, nullable: true }) gender!:
    | string
    | null;
  @Column({ type: 'varchar', length: 20, nullable: true })
  orientation!: string | null;
  @Column({
    name: 'supported_engines',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  supportedEngines!: string[];
  @Column({
    name: 'provider_voice_id',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  providerVoiceId!: string | null;
  @Column({ name: 'preview_image_url', type: 'text', nullable: true })
  previewImageUrl!: string | null;
  @Column({ type: 'boolean', default: true }) available!: boolean;
  @Column({ name: 'synced_at', type: 'timestamptz', default: () => 'now()' })
  syncedAt!: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
