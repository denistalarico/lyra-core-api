import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export const SOCIAL_APPROVAL_SNAPSHOT_KINDS = [
  'table',
  'text',
  'link',
  'file',
  'media_set',
] as const;
export type SocialApprovalSnapshotKind =
  (typeof SOCIAL_APPROVAL_SNAPSHOT_KINDS)[number];

export type ApprovalTableSnapshotPayload = {
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | null>>;
  /** AR3: what a campaign table says about the campaign itself. */
  summary?: Array<{ label: string; value: string }>;
};
export type ApprovalTextSnapshotPayload = { body: string };
export type ApprovalLinkSnapshotPayload = { url: string; label: string | null };
/** `storagePath` is a private copy (D-29) and never leaves the server. */
export type ApprovalFileSnapshotPayload = {
  fileName: string;
  mimeType: string;
  byteSize: string;
  storagePath: string;
};
export type ApprovalMediaSetSnapshotPayload = {
  items: Array<{
    mediaAssetId: string;
    assetType: 'image' | 'video';
    mimeType: string;
    thumbnailMediaAssetId: string | null;
    /** Formats this file serves; absent on snapshots older than the tabs. */
    placements?: string[];
  }>;
};
export type ApprovalSnapshotPayload =
  | ApprovalTableSnapshotPayload
  | ApprovalTextSnapshotPayload
  | ApprovalLinkSnapshotPayload
  | ApprovalFileSnapshotPayload
  | ApprovalMediaSetSnapshotPayload;

/**
 * AR1 — immutable picture of what was sent (D-11), the subject of every
 * `approval_snapshot` request. Append-only at the database. The payload is
 * always assembled on the server.
 */
@Entity('social_approval_snapshots')
@Index('UQ_social_approval_snapshots_revision', ['stepId', 'revisionNumber'], {
  unique: true,
})
export class SocialApprovalSnapshotEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;
  @Column({ name: 'step_id', type: 'uuid' }) stepId!: string;
  @Column({ name: 'revision_number', type: 'integer' }) revisionNumber!: number;
  @Column({ type: 'varchar', length: 16 }) kind!: SocialApprovalSnapshotKind;
  @Column({ type: 'jsonb' }) payload!: ApprovalSnapshotPayload;
  @Column({ name: 'content_hash', type: 'varchar', length: 64 })
  contentHash!: string;
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId!: string | null;
  @Column({ name: 'created_by_surface', type: 'varchar', length: 24 })
  createdBySurface!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
