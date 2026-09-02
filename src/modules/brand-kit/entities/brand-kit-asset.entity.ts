import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BrandKitEntity } from './brand-kit.entity';

/**
 * One binary belonging to a Brand Kit — a logo variant or a creative
 * reference (Lyra Social S1.4.9).
 *
 * The bytes live in the PRIVATE bucket; this row holds only metadata plus the
 * storage key. `storage_path` never leaves the backend: the API projection
 * exposes `contentPath` (an authenticated endpoint) instead, so the object
 * key is never a capability the browser can replay.
 *
 * Scope columns are denormalized from the parent kit on purpose. Every
 * authorization check and every list query filters by tenant/client, and
 * joining to `brand_kits` for that on each read would make the cheapest and
 * most security-critical query the most expensive one.
 */

export const BRAND_KIT_ASSET_KINDS = ['logo', 'reference'] as const;
export type BrandKitAssetKind = (typeof BRAND_KIT_ASSET_KINDS)[number];

/**
 * Logo shape. Two columns (`variant` × `theme`) rather than five booleans:
 * one file can legitimately be `horizontal` + `dark`, and a future variant
 * costs no migration. `NULL` for references, which have no such axis.
 */
export const BRAND_KIT_ASSET_VARIANTS = [
  'vertical',
  'horizontal',
  'mark',
] as const;
export type BrandKitAssetVariant = (typeof BRAND_KIT_ASSET_VARIANTS)[number];

export const BRAND_KIT_ASSET_THEMES = ['light', 'dark'] as const;
export type BrandKitAssetTheme = (typeof BRAND_KIT_ASSET_THEMES)[number];

@Index('IDX_brand_kit_assets_kit', ['brandKitId', 'kind'])
@Index('IDX_brand_kit_assets_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
@Entity('brand_kit_assets')
export class BrandKitAssetEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'brand_kit_id', type: 'uuid' })
  brandKitId!: string;

  @ManyToOne(() => BrandKitEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'brand_kit_id' })
  brandKit?: BrandKitEntity;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ type: 'varchar', length: 24 })
  kind!: BrandKitAssetKind;

  @Column({ type: 'varchar', length: 24, nullable: true })
  variant!: BrandKitAssetVariant | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  theme!: BrandKitAssetTheme | null;

  /**
   * Key in the PRIVATE bucket. Never projected to any client — see the class
   * doc. Not a URL, not a signed URL: a signed URL is a bearer capability and
   * persisting one would outlive both the session and any permission change.
   */
  @Column({ name: 'storage_path', type: 'varchar', length: 512 })
  storagePath!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 128 })
  mimeType!: string;

  /** bigint: byte counts outgrow int32 and JS numbers lose precision. */
  @Column({ name: 'byte_size', type: 'bigint' })
  byteSize!: string;

  @Column({ type: 'integer', nullable: true })
  width!: number | null;

  @Column({ type: 'integer', nullable: true })
  height!: number | null;

  /** Sanitized for display only — never used to build the storage key. */
  @Column({ name: 'original_filename', type: 'varchar', length: 255 })
  originalFilename!: string;

  /** sha256, so a re-upload of identical bytes is recognizable. */
  @Column({ type: 'char', length: 64, nullable: true })
  checksum!: string | null;

  /** Tags, provenance, usage notes — product metadata, never credentials. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /**
   * The tombstone that makes deletion safe across two stores.
   *
   * `BrandKitService.deleteAsset` marks this BEFORE touching the bucket, so
   * the asset stops being listed and stops serving content the moment the
   * user asks for it — then removes the binary, then drops the row. If the
   * storage call fails, the row survives with `deleted_at` and
   * `storage_path` intact: the binary stays traceable and the delete stays
   * retryable, instead of leaving an orphan whose identity was already
   * erased from the database.
   *
   * So a row with `deleted_at` set means "delete in progress or incomplete",
   * never "kept for undo": once the bytes are gone the row goes too.
   */
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
