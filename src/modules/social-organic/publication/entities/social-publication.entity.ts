import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MediaAssetEntity } from '../../../../common/media-assets';
import { SocialContentDestinationEntity } from '../../../social-planner/entities/social-content-destination.entity';
import { SocialContentItemEntity } from '../../../social-planner/entities/social-content-item.entity';
import { SocialOrganicAssetEntity } from '../../entities/social-organic-asset.entity';
import { SocialOrganicConnectionEntity } from '../../entities/social-organic-connection.entity';
import type { SocialPublicationStatus } from '../social-publication.state';

export type SocialPublicationFailureReason =
  | 'credential_expired'
  | 'permission_lost'
  | 'rate_limited'
  | 'media_rejected'
  | 'payload_invalid'
  | 'provider_unavailable'
  | 'duplicate_content'
  | 'asset_disabled'
  | 'unknown';

/** Immutable execution evidence once provider processing starts. */
@Entity('social_publications')
@Index(
  'UQ_social_publications_destination_idempotency',
  ['destinationId', 'idempotencyKey'],
  {
    unique: true,
    where: `"destination_id" IS NOT NULL`,
  },
)
@Index('IDX_social_publications_queue', ['availableAt'], {
  where: `"status" IN ('queued', 'scheduled')`,
})
@Index('IDX_social_publications_scope_schedule', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'scheduledAt',
])
@Check(
  'CK_social_publications_status',
  `"status" IN ('draft', 'scheduled', 'queued', 'processing', 'published', 'failed', 'cancelled')`,
)
@Check(
  'CK_social_publications_failure_reason',
  `"failure_reason" IS NULL OR "failure_reason" IN ('credential_expired', 'permission_lost', 'rate_limited', 'media_rejected', 'payload_invalid', 'provider_unavailable', 'duplicate_content', 'asset_disabled', 'unknown')`,
)
export class SocialPublicationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** NULL means the agency's own context; otherwise this is a managed client. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'content_item_id', type: 'uuid' })
  contentItemId!: string;

  @ManyToOne(() => SocialContentItemEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'content_item_id',
    foreignKeyConstraintName: 'FK_social_publications_content_item',
  })
  contentItem!: SocialContentItemEntity;

  /** NULL only for a publication created outside the Planner. */
  @Column({ name: 'destination_id', type: 'uuid', nullable: true })
  destinationId!: string | null;

  @ManyToOne(() => SocialContentDestinationEntity, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'destination_id',
    foreignKeyConstraintName: 'FK_social_publications_destination',
  })
  destination!: SocialContentDestinationEntity | null;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @ManyToOne(() => SocialOrganicConnectionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'connection_id',
    foreignKeyConstraintName: 'FK_social_publications_connection',
  })
  connection!: SocialOrganicConnectionEntity;

  @Column({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  @ManyToOne(() => SocialOrganicAssetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'asset_id',
    foreignKeyConstraintName: 'FK_social_publications_asset',
  })
  asset!: SocialOrganicAssetEntity;

  /** Denormalized so the audit trail survives asset archival. */
  @Column({ name: 'external_asset_id', type: 'varchar', length: 180 })
  externalAssetId!: string;

  /**
   * The private-bucket media this publication publishes, distinct from
   * `assetId` (the destination account). NULL for text-only publications.
   * FK is RESTRICT: a MediaAsset behind a historical publication can never be
   * deleted out from under it.
   */
  @Column({ name: 'media_asset_id', type: 'uuid', nullable: true })
  mediaAssetId!: string | null;

  @ManyToOne(() => MediaAssetEntity, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'media_asset_id',
    foreignKeyConstraintName: 'FK_social_publications_media_asset',
  })
  mediaAsset!: MediaAssetEntity | null;

  @Column({ type: 'varchar', length: 24 })
  status!: SocialPublicationStatus;

  /** Lyra's authoritative desired publication time. */
  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  scheduledAt!: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({
    name: 'external_publication_id',
    type: 'varchar',
    length: 240,
    nullable: true,
  })
  externalPublicationId!: string | null;

  @Column({ name: 'external_permalink', type: 'text', nullable: true })
  externalPermalink!: string | null;

  /** Exact provider-neutral payload selected for this execution. */
  @Column({ name: 'payload_snapshot', type: 'jsonb' })
  payloadSnapshot!: Record<string, unknown>;

  @Column({ name: 'payload_hash', type: 'varchar', length: 64 })
  payloadHash!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 200 })
  idempotencyKey!: string;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 5 })
  maxAttempts!: number;

  /** Not before this instant; retries move it forward instead of sleeping. */
  @Column({ name: 'available_at', type: 'timestamptz' })
  availableAt!: Date;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ name: 'locked_by', type: 'varchar', length: 120, nullable: true })
  lockedBy!: string | null;

  /** Safe code only; raw provider messages must never be persisted here. */
  @Column({
    name: 'last_error_code',
    type: 'varchar',
    length: 240,
    nullable: true,
  })
  lastErrorCode!: string | null;

  @Column({
    name: 'failure_reason',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  failureReason!: SocialPublicationFailureReason | null;

  /** Raw provider response; never expose this column through a controller. */
  @Column({
    name: 'provider_metadata',
    type: 'jsonb',
    default: () => `'{}'::jsonb`,
    select: false,
  })
  providerMetadata!: Record<string, unknown>;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @Column({ name: 'cancelled_by_id', type: 'uuid', nullable: true })
  cancelledById!: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
