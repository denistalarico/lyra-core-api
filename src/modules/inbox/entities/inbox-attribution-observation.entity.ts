import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One observed acquisition referral, exactly as the provider reported it.
 *
 * Append-only by discipline rather than by trigger: nothing in the codebase
 * updates a row here, and the reason is the point of the table. First-touch is
 * the earliest row for a conversation and last-touch is the latest; neither is
 * a column, because storing a derived answer is what turns a second
 * observation into the silent destruction of the first.
 *
 * See the migration for why this is a table rather than message metadata.
 */
@Entity('inbox_attribution_observations')
@Index(
  'UQ_inbox_attribution_observation_message',
  ['tenantId', 'workspaceId', 'messageId'],
  { unique: true },
)
@Index('IDX_inbox_attribution_observations_conversation', [
  'conversationId',
  'observedAt',
])
@Check(
  'CK_inbox_attribution_observations_identifier',
  `"ad_id" IS NOT NULL OR "click_id" IS NOT NULL`,
)
export class InboxAttributionObservationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /**
   * Resolved from the channel at write time and then frozen. Re-pointing a
   * channel at another client must not re-attribute the ad spend that reached
   * the previous one.
   */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ name: 'message_id', type: 'uuid' })
  messageId!: string;

  @Column({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId!: string | null;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  @Column({ name: 'channel_type', type: 'varchar', length: 40 })
  channelType!: string;

  /**
   * Same type and identity space as `social_ad_entities.external_id`, so the
   * join a future Intelligence layer performs needs no cast and no
   * normalization. Nullable: an organic-surface referral has a click id and no
   * ad.
   */
  @Column({ name: 'ad_id', type: 'varchar', length: 180, nullable: true })
  adId!: string | null;

  @Column({ name: 'click_id', type: 'varchar', length: 180, nullable: true })
  clickId!: string | null;

  /** `ad`, `post`, `page` — the surface clicked, not the object. */
  @Column({ name: 'source_type', type: 'varchar', length: 60, nullable: true })
  sourceType!: string | null;

  /** Provider time, not write time — ordering must survive a replay. */
  @Column({ name: 'observed_at', type: 'timestamptz' })
  observedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
