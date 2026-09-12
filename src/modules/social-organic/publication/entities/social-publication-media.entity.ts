import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MediaAssetEntity } from '../../../../common/media-assets';
import { SocialPublicationEntity } from './social-publication.entity';

/** Immutable ordered media evidence for one publication attempt. */
@Entity('social_publication_media')
@Index('UQ_social_publication_media_order', ['publicationId', 'sortOrder'], { unique: true })
export class SocialPublicationMediaEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Column({ name: 'publication_id', type: 'uuid' })
  publicationId!: string;

  @ManyToOne(() => SocialPublicationEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'publication_id', foreignKeyConstraintName: 'FK_social_publication_media_publication' })
  publication!: SocialPublicationEntity;

  @Column({ name: 'media_asset_id', type: 'uuid' })
  mediaAssetId!: string;

  @ManyToOne(() => MediaAssetEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'media_asset_id', foreignKeyConstraintName: 'FK_social_publication_media_asset' })
  mediaAsset!: MediaAssetEntity;

  @Column({ type: 'varchar', length: 40, default: 'primary' })
  role!: string;

  @Column({ name: 'sort_order', type: 'integer' })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
