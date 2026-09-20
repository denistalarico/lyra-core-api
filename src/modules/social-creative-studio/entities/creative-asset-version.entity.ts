import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('social_creative_asset_versions')
@Unique('UQ_social_creative_asset_versions_number', ['creativeAssetId', 'versionNumber'])
@Index('IDX_social_creative_asset_versions_asset', ['creativeAssetId', 'versionNumber'])
@Check('CK_social_creative_asset_versions_number', '"version_number" > 0')
@Check('CK_social_creative_asset_versions_source', `"source" IN ('upload', 'replace')`)
export class CreativeAssetVersionEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'creative_asset_id', type: 'uuid' }) creativeAssetId!: string;
  @Column({ name: 'version_number', type: 'integer' }) versionNumber!: number;
  @Column({ name: 'media_asset_id', type: 'uuid' }) mediaAssetId!: string;
  /** Derived image only; never the original version binary. */
  @Column({ name: 'thumbnail_media_asset_id', type: 'uuid', nullable: true }) thumbnailMediaAssetId!: string | null;
  @Column({ type: 'varchar', length: 16 }) source!: 'upload' | 'replace';
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true }) createdById!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
