import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CreativeAssetType = 'image' | 'video';
export type CreativeAssetStatus = 'ready' | 'archived';

@Entity('social_creative_assets')
@Index('IDX_social_creative_assets_scope_created', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'companyContextId',
  'createdAt',
])
@Index('IDX_social_creative_assets_folder', ['folderId'])
@Index('IDX_social_creative_assets_content', ['contentItemId'])
@Check('CK_social_creative_assets_type', `"asset_type" IN ('image', 'video')`)
@Check('CK_social_creative_assets_status', `"status" IN ('ready', 'archived')`)
export class CreativeAssetEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'workspace_id', type: 'uuid' }) workspaceId!: string;
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;
  @Column({ name: 'company_context_id', type: 'uuid', nullable: true })
  companyContextId!: string | null;
  @Column({ type: 'varchar', length: 255 }) name!: string;
  @Column({ name: 'asset_type', type: 'varchar', length: 16 })
  assetType!: CreativeAssetType;
  @Column({
    name: 'source_type',
    type: 'varchar',
    length: 40,
    default: 'upload',
  })
  sourceType!: string;
  @Column({ type: 'varchar', length: 16, default: 'ready' })
  status!: CreativeAssetStatus;
  @Column({ name: 'folder_id', type: 'uuid', nullable: true }) folderId!:
    | string
    | null;
  @Column({ name: 'current_version_id', type: 'uuid', nullable: true })
  currentVersionId!: string | null;
  @Column({ name: 'content_item_id', type: 'uuid', nullable: true })
  contentItemId!: string | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) metadata!: Record<
    string,
    unknown
  >;
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;
  /** In the Lixeira since this moment; purged after the retention period. */
  @Column({ name: 'trashed_at', type: 'timestamptz', nullable: true })
  trashedAt!: Date | null;
  /** The folder it left, for Restaurar. No FK: the folder may be gone by then. */
  @Column({ name: 'restore_folder_id', type: 'uuid', nullable: true })
  restoreFolderId!: string | null;
  /** Set by Restaurar: retention never takes this file again. */
  @Column({ name: 'restored_at', type: 'timestamptz', nullable: true })
  restoredAt!: Date | null;
  /** Overrides the default Lixeira period when retention sent it there. */
  @Column({ name: 'purge_after', type: 'timestamptz', nullable: true })
  purgeAfter!: Date | null;
  /**
   * Library deletion. A plain column, not `@DeleteDateColumn`: Approvals and
   * Production keep resolving the rows they already reference.
   */
  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
