import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { MetaCommentContentKind } from '../channels/meta/adapters/meta-comment.normalizer';

/**
 * Cache of the post, reel or ad a comment sits on (IX3), refreshed after 24h.
 *
 * Never the Instagram `media_url`: that link expires in about five days (Social
 * organic discovery found it), so only `thumbnail_url` and `permalink` are
 * kept, and the thumbnail is re-read with the content after 24h.
 */
@Entity('inbox_comment_contents')
@Index(
  'uq_inbox_comment_contents_external',
  ['tenantId', 'workspaceId', 'channelId', 'externalContentId'],
  { unique: true },
)
export class InboxCommentContentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'channel_id', type: 'uuid' })
  channelId!: string;

  @Column({ name: 'external_content_id', type: 'varchar', length: 180 })
  externalContentId!: string;

  @Column({ name: 'content_kind', type: 'varchar', length: 16 })
  contentKind!: MetaCommentContentKind;

  @Column({ type: 'text', nullable: true })
  permalink!: string | null;

  @Column({ type: 'text', nullable: true })
  caption!: string | null;

  @Column({ name: 'thumbnail_url', type: 'text', nullable: true })
  thumbnailUrl!: string | null;

  @Column({ name: 'is_published', type: 'boolean', nullable: true })
  isPublished!: boolean | null;

  @Column({
    name: 'ad_external_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  adExternalId!: string | null;

  @Column({ name: 'ad_name', type: 'varchar', length: 400, nullable: true })
  adName!: string | null;

  @Column({
    name: 'campaign_name',
    type: 'varchar',
    length: 400,
    nullable: true,
  })
  campaignName!: string | null;

  @Column({ name: 'provider_created_at', type: 'timestamptz', nullable: true })
  providerCreatedAt!: Date | null;

  /** Null until Graph answered once; a failed read leaves it null. */
  @Column({ name: 'fetched_at', type: 'timestamptz', nullable: true })
  fetchedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
