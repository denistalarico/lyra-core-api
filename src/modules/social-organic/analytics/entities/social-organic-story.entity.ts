import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One Instagram story, captured while it was live.
 *
 * ## Why stories are not rows in the post fact table
 *
 * `social_organic_post_metrics_daily` has a grain of "one observation per day
 * per publication", and that grain assumes the publication can be observed
 * again tomorrow. A feed post or a reel can: `/{ig-user}/media` still lists a
 * reel from last year, so a sync that misses one catches it on the next pass.
 *
 * A story cannot. It is readable for 24 hours and then it is gone — and it is
 * never in `/{ig-user}/media` at all, only on `/{ig-user}/stories` and only
 * while it is live. Verified on 2026-09-24: 378 media items across four pages
 * of a real account, not one story among them.
 *
 * So this table is not a cache. It is the only record of a story that will ever
 * exist, and an hour the collector does not run is content permanently lost.
 * The shape follows from that: one row per story rather than one per day, and
 * the row is updated in place as the story's counters move through its day.
 *
 * ## Every counter is a lifetime stock
 *
 * The numbers are cumulative since the story was posted, not a flow, and they
 * are never summed across days. They may be summed *across stories* for a
 * period total — twelve stories' replies really do add up to the period's
 * replies — but reach may not, for the usual reason: the same account reached
 * by two stories is one account.
 */
@Entity('social_organic_stories')
@Index('IDX_social_organic_stories_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'publishedAt',
])
@Index('IDX_social_organic_stories_asset_published', ['assetId', 'publishedAt'])
@Check(
  'CK_social_organic_stories_non_negative',
  `("reach" IS NULL OR "reach" >= 0)
   AND ("views" IS NULL OR "views" >= 0)
   AND ("replies" IS NULL OR "replies" >= 0)
   AND ("shares" IS NULL OR "shares" >= 0)
   AND ("total_interactions" IS NULL OR "total_interactions" >= 0)
   AND ("profile_visits" IS NULL OR "profile_visits" >= 0)
   AND ("follows" IS NULL OR "follows" >= 0)
   AND ("nav_forward" IS NULL OR "nav_forward" >= 0)
   AND ("nav_next_story" IS NULL OR "nav_next_story" >= 0)
   AND ("nav_back" IS NULL OR "nav_back" >= 0)
   AND ("nav_exit" IS NULL OR "nav_exit" >= 0)`,
)
export class SocialOrganicStoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  @Column({ name: 'provider', type: 'varchar', length: 40 })
  provider!: string;

  @Column({
    name: 'external_publication_id',
    type: 'varchar',
    length: 191,
  })
  externalPublicationId!: string;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'media_type', type: 'varchar', length: 40, nullable: true })
  mediaType!: string | null;

  @Column({ name: 'permalink', type: 'varchar', length: 500, nullable: true })
  permalink!: string | null;

  /**
   * The creative, for as long as the signed URL lasts.
   *
   * Meta signs media URLs with a ~5 day expiry while the story itself is gone
   * after one day, so this is best-effort by construction: it is the picture
   * for a report opened soon after, and null-in-practice for one opened later.
   * A reader must render the absence, not assume a URL is good.
   */
  @Column({ name: 'media_url', type: 'varchar', length: 1000, nullable: true })
  mediaUrl!: string | null;

  @Column({
    name: 'thumbnail_url',
    type: 'varchar',
    length: 1000,
    nullable: true,
  })
  thumbnailUrl!: string | null;

  /** Unique accounts. Never summed across stories. */
  @Column({ name: 'reach', type: 'bigint', nullable: true })
  reach!: string | null;

  @Column({ name: 'views', type: 'bigint', nullable: true })
  views!: string | null;

  @Column({ name: 'replies', type: 'bigint', nullable: true })
  replies!: string | null;

  @Column({ name: 'shares', type: 'bigint', nullable: true })
  shares!: string | null;

  @Column({ name: 'total_interactions', type: 'bigint', nullable: true })
  totalInteractions!: string | null;

  @Column({ name: 'profile_visits', type: 'bigint', nullable: true })
  profileVisits!: string | null;

  @Column({ name: 'follows', type: 'bigint', nullable: true })
  follows!: string | null;

  /**
   * How the viewer left this story, from `navigation` broken down by
   * `story_navigation_action_type`.
   *
   * Nullable and expected to stay null on accounts that post no stories: these
   * could not be verified against the production account, which has never had a
   * story live while one was being observed and cannot be asked about an
   * expired one. The collector treats Meta refusing them as an absent metric,
   * not a failed sync, so an unverified assumption degrades to a blank column
   * rather than to a broken pass.
   */
  @Column({ name: 'nav_forward', type: 'bigint', nullable: true })
  navForward!: string | null;

  @Column({ name: 'nav_next_story', type: 'bigint', nullable: true })
  navNextStory!: string | null;

  @Column({ name: 'nav_back', type: 'bigint', nullable: true })
  navBack!: string | null;

  @Column({ name: 'nav_exit', type: 'bigint', nullable: true })
  navExit!: string | null;

  /** When the counters above were last read. */
  @Column({
    name: 'observed_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  observedAt!: Date;

  /** The first time this story was seen live — the closest thing to a capture. */
  @Column({
    name: 'first_observed_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  firstObservedAt!: Date;

  @Column({ name: 'sync_run_id', type: 'uuid', nullable: true })
  syncRunId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
