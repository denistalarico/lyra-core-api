import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('social_content_destinations')
@Unique('UQ_social_content_destinations_channel_placement', [
  'contentItemId',
  'channel',
  'placement',
])
@Index('IDX_social_content_destinations_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
])
@Index('IDX_social_content_destinations_content', ['contentItemId'])
export class SocialContentDestinationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'content_item_id', type: 'uuid' })
  contentItemId!: string;

  /**
   * Canonical channel key, e.g. instagram, facebook, youtube, x.
   * Connection/provider capabilities are a different concern.
   */
  @Column({ type: 'varchar', length: 40 })
  channel!: string;

  /**
   * Canonical editorial placement, e.g. feed, story, reel, short, post.
   */
  @Column({ type: 'varchar', length: 40 })
  placement!: string;

  /**
   * Desired channel-specific date/time. This is planning data, not proof that
   * a provider publication was scheduled successfully.
   */
  @Column({ name: 'planned_at', type: 'timestamptz', nullable: true })
  plannedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
