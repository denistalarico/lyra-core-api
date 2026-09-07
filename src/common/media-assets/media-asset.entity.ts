import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Persistent identity for a reusable private-bucket object.
 *
 * This entity belongs to the shared Files/Assets boundary rather than to a
 * product module. `storagePath` is an object key, never a URL or a client
 * projection. Callers that expose media must produce an authorized view or a
 * short-lived capability instead of returning this entity.
 */
@Entity('media_assets')
@Index('IDX_media_assets_scope', ['tenantId', 'workspaceId', 'agencyClientId'])
@Index(
  'IDX_media_assets_scope_checksum',
  ['tenantId', 'workspaceId', 'agencyClientId', 'checksum'],
  { where: 'checksum IS NOT NULL' },
)
export class MediaAssetEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** NULL means the agency's own context; otherwise a managed client. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  /** Key in the private bucket. Backend-only; not a URL or bearer capability. */
  @Column({ name: 'storage_path', type: 'varchar', length: 512 })
  storagePath!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 128 })
  mimeType!: string;

  /** PostgreSQL bigint is kept as a string so byte counts remain exact. */
  @Column({ name: 'byte_size', type: 'bigint' })
  byteSize!: string;

  /** Display metadata only; never used to derive the storage key. */
  @Column({
    name: 'original_filename',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  originalFilename!: string | null;

  /** Optional SHA-256. Recognition is scoped and deliberately non-unique. */
  @Column({ type: 'char', length: 64, nullable: true })
  checksum!: string | null;

  @Column({ type: 'integer', nullable: true })
  width!: number | null;

  @Column({ type: 'integer', nullable: true })
  height!: number | null;

  /** PostgreSQL bigint is kept as a string so long durations remain exact. */
  @Column({ name: 'duration_ms', type: 'bigint', nullable: true })
  durationMs!: string | null;

  @Column({ type: 'varchar', nullable: true })
  codec!: string | null;

  /** Open provenance vocabulary; adding a source never requires a migration. */
  @Column({ type: 'varchar' })
  source!: string;

  /**
   * Sanitized product metadata only. Credentials, access tokens and other
   * secrets are forbidden here and belong in their dedicated secure stores.
   */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /** Lifecycle tombstone for cleanup/reconciliation, never an undo record. */
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
