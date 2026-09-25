import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SocialOrganicMetricSource = 'organic';

/**
 * Daily flow metrics for one provider publication.
 *
 * Every counter uses `bigint`: provider totals can exceed a signed 32-bit
 * integer. No ratio belongs in this table. Engagement rate and every other
 * quotient must be derived from counters at read time so aggregating rows
 * cannot silently average ratios with the wrong weights.
 *
 * Reach is a de-duplicated audience, not an additive flow. It may be displayed
 * for this row's grain, but must never be summed across days.
 *
 * The `*_lifetime` columns below are a structurally SEPARATE SNAPSHOT/stock
 * fact, not a flow. Meta v26 exposes the only candidate Page-post/IG-media
 * counters (`post_media_view`; `comments`/`likes`/`views`) only as
 * `period=lifetime` cumulative totals, never as a daily flow — so they are
 * never summed or averaged across days, and never merged into the flow
 * columns above. Each `*_lifetime` column is paired with its own
 * `*_lifetime_observed_at`, which is the instant Lyra observed the snapshot
 * (this row's `metricDate`, stamped as the sync's `currentDay`), not the
 * post's publish time. A reader takes only the latest observation in the
 * requested period; it is never an unconditional overwrite target.
 */
@Entity('social_organic_post_metrics_daily')
@Index(
  'UQ_social_organic_post_metrics_daily_fact',
  ['assetId', 'externalPublicationId', 'metricDate', 'source'],
  { unique: true },
)
@Index('IDX_social_organic_post_metrics_daily_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'metricDate',
])
@Index(
  'IDX_social_organic_post_metrics_daily_partial',
  ['assetId', 'metricDate'],
  {
    where: '"is_partial"',
  },
)
@Check(
  'CK_social_organic_post_metrics_daily_non_negative',
  `"impressions" >= 0
   AND "reach" >= 0
   AND "likes" >= 0
   AND "comments" >= 0
   AND "shares" >= 0
   AND "saves" >= 0
   AND "video_views" >= 0
   AND "watch_time_seconds" >= 0
   AND "link_clicks" >= 0
   AND "profile_visits" >= 0
   AND "impressions_lifetime" >= 0
   AND "likes_lifetime" >= 0
   AND "comments_lifetime" >= 0
   AND "video_views_lifetime" >= 0`,
)
export class SocialOrganicPostMetricDailyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** NULL means the agency's own context; otherwise this is a managed client. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  @Column({ type: 'varchar', length: 24, default: 'organic' })
  source!: SocialOrganicMetricSource;

  @Column({ name: 'external_publication_id', type: 'varchar', length: 180 })
  externalPublicationId!: string;

  /** Nullable because provider-discovered posts have no local publication. */
  @Column({ name: 'publication_id', type: 'uuid', nullable: true })
  publicationId!: string | null;

  /** Calendar day in `assetTimezone`, not an instant. */
  @Column({ name: 'metric_date', type: 'date' })
  metricDate!: string;

  /** Required per row; a missing asset timezone must never become UTC. */
  @Column({ name: 'asset_timezone', type: 'varchar', length: 64 })
  assetTimezone!: string;

  @Column({ type: 'bigint', nullable: true })
  impressions!: string | null;

  /** De-duplicated audience for this grain; never sum across days. */
  @Column({ type: 'bigint', nullable: true })
  reach!: string | null;

  @Column({ type: 'bigint', nullable: true })
  likes!: string | null;

  @Column({ type: 'bigint', nullable: true })
  comments!: string | null;

  @Column({ type: 'bigint', nullable: true })
  shares!: string | null;

  @Column({ type: 'bigint', nullable: true })
  saves!: string | null;

  @Column({ name: 'video_views', type: 'bigint', nullable: true })
  videoViews!: string | null;

  @Column({ name: 'watch_time_seconds', type: 'bigint', nullable: true })
  watchTimeSeconds!: string | null;

  @Column({ name: 'link_clicks', type: 'bigint', nullable: true })
  linkClicks!: string | null;

  @Column({ name: 'profile_visits', type: 'bigint', nullable: true })
  profileVisits!: string | null;

  /**
   * SNAPSHOT counters from `/{ig-media-id}/insights`, cumulative since the post
   * was published. Never summed across days — a reader takes the latest
   * observation, exactly as it does for the four `*_lifetime` columns below.
   *
   * They are deliberately not written into the flow columns of the same name
   * (`reach`, `shares`, `saves`): those mean "this day's value", and a lifetime
   * total stored there would be summed by any reader that trusts the column.
   */
  @Column({ name: 'reach_lifetime', type: 'bigint', nullable: true })
  reachLifetime!: string | null;

  @Column({ name: 'saves_lifetime', type: 'bigint', nullable: true })
  savesLifetime!: string | null;

  @Column({ name: 'shares_lifetime', type: 'bigint', nullable: true })
  sharesLifetime!: string | null;

  /** Likes + comments + saves + shares, as Meta totals them. */
  @Column({
    name: 'total_interactions_lifetime',
    type: 'bigint',
    nullable: true,
  })
  totalInteractionsLifetime!: string | null;

  @Column({ name: 'profile_visits_lifetime', type: 'bigint', nullable: true })
  profileVisitsLifetime!: string | null;

  /** Accounts that followed the profile *from* this post. */
  @Column({ name: 'follows_lifetime', type: 'bigint', nullable: true })
  followsLifetime!: string | null;

  /**
   * When the six counters above were observed.
   *
   * One column for all of them because one request returns all of them, unlike
   * the older `*_lifetime` counters, which each carry their own timestamp
   * because they were added by separate reads.
   */
  @Column({ name: 'lifetime_observed_at', type: 'timestamptz', nullable: true })
  lifetimeObservedAt!: Date | null;

  /**
   * The post's public URL — stable, unlike the image.
   *
   * Meta's CDN image URLs are signed and expire in about five days, so they are
   * never stored; the thumbnail is re-resolved on demand. This one does not
   * expire and is what identifies the post to a human.
   */
  @Column({ name: 'permalink', type: 'varchar', length: 500, nullable: true })
  permalink!: string | null;

  /** The caption as published, for recognising the post in a table. */
  @Column({ name: 'caption', type: 'text', nullable: true })
  caption!: string | null;

  /** `IMAGE`, `VIDEO`, `CAROUSEL_ALBUM` — Meta's own spelling. */
  @Column({ name: 'media_type', type: 'varchar', length: 40, nullable: true })
  mediaType!: string | null;

  /** `FEED`, `REEL`, `STORY` — the surface, which `media_type` does not say. */
  @Column({
    name: 'media_product_type',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  mediaProductType!: string | null;

  /**
   * When the post was published, as the provider reports it.
   *
   * Distinct from `metric_date`, which is the day the snapshot was *observed*.
   * A post published in August still gets a row dated today every time its
   * lifetime totals are re-read.
   */
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  /**
   * SNAPSHOT, not flow — FB `post_media_view`, `period=lifetime`. Never
   * summed/averaged across days; a reader takes the latest observation.
   */
  @Column({ name: 'impressions_lifetime', type: 'bigint', nullable: true })
  impressionsLifetime!: string | null;

  /** Instant Lyra observed `impressionsLifetime`, not the post's publish time. */
  @Column({
    name: 'impressions_lifetime_observed_at',
    type: 'timestamptz',
    nullable: true,
  })
  impressionsLifetimeObservedAt!: Date | null;

  /**
   * SNAPSHOT, not flow — IG media `likes`, `period=lifetime`. Never
   * summed/averaged across days; a reader takes the latest observation.
   */
  @Column({ name: 'likes_lifetime', type: 'bigint', nullable: true })
  likesLifetime!: string | null;

  /** Instant Lyra observed `likesLifetime`, not the post's publish time. */
  @Column({
    name: 'likes_lifetime_observed_at',
    type: 'timestamptz',
    nullable: true,
  })
  likesLifetimeObservedAt!: Date | null;

  /**
   * SNAPSHOT, not flow — IG media `comments`, `period=lifetime`. Never
   * summed/averaged across days; a reader takes the latest observation.
   */
  @Column({ name: 'comments_lifetime', type: 'bigint', nullable: true })
  commentsLifetime!: string | null;

  /** Instant Lyra observed `commentsLifetime`, not the post's publish time. */
  @Column({
    name: 'comments_lifetime_observed_at',
    type: 'timestamptz',
    nullable: true,
  })
  commentsLifetimeObservedAt!: Date | null;

  /**
   * SNAPSHOT, not flow — IG media `views`, `period=lifetime`. Never
   * summed/averaged across days; a reader takes the latest observation.
   */
  @Column({ name: 'video_views_lifetime', type: 'bigint', nullable: true })
  videoViewsLifetime!: string | null;

  /** Instant Lyra observed `videoViewsLifetime`, not the post's publish time. */
  @Column({
    name: 'video_views_lifetime_observed_at',
    type: 'timestamptz',
    nullable: true,
  })
  videoViewsLifetimeObservedAt!: Date | null;

  /**
   * Average watch time of this reel, in milliseconds.
   *
   * Reels only — Meta refuses the metric for any other product type, and
   * refuses the *whole request* along with it, which is why the metric list is
   * chosen per surface. Null on a feed post, always.
   *
   * Not summable across posts and not averageable without weights: it is
   * already a mean over one reel's views, so averaging two reels' averages
   * would weight a reel with 10 views the same as one with 10 000.
   */
  @Column({
    name: 'reels_avg_watch_time_ms',
    type: 'bigint',
    nullable: true,
  })
  reelsAvgWatchTimeMs!: string | null;

  /** Total time this reel was watched, in milliseconds. Additive across reels. */
  @Column({
    name: 'reels_total_watch_time_ms',
    type: 'bigint',
    nullable: true,
  })
  reelsTotalWatchTimeMs!: string | null;

  /**
   * Share of views that skipped this reel in its first 3 seconds, in **basis
   * points**: 66.1% is 6610.
   *
   * Stored scaled because this table's rule is that no ratio lives in it as a
   * ratio — a stored percentage gets averaged across rows with the wrong
   * weights the first time anyone aggregates. Basis points keep it exact and
   * integral, and the column name says it is not a counter.
   */
  @Column({ name: 'reels_skip_rate_bp', type: 'bigint', nullable: true })
  reelsSkipRateBp!: string | null;

  /** Times this reel was reposted. Reels only. */
  @Column({ name: 'reposts_lifetime', type: 'bigint', nullable: true })
  repostsLifetime!: string | null;

  /**
   * Reactions on a Facebook Page post, split by type.
   *
   * Facebook only. Instagram has one reaction — the like — which already has a
   * column; asking Meta for `post_reactions_by_type_total` on IG media is
   * refused outright.
   *
   * ## Why six columns and not one jsonb map
   *
   * Meta answers with a map (`{"like": 1, "love": 3}`), and storing it as one
   * would be a smaller change. But the operator's table has a column per emoji
   * and sorts by them, and a reader that has to unpack jsonb cannot push that
   * sort into SQL. The six types are a closed set Meta has not changed since
   * 2016; a seventh would need a migration, which is the right amount of
   * friction for something that would also need a column in the UI.
   *
   * Every one is nullable and stays null on Instagram, where the metric does
   * not exist — never zero, which would claim nobody reacted.
   */
  @Column({ name: 'reactions_total', type: 'bigint', nullable: true })
  reactionsTotal!: string | null;

  @Column({ name: 'reactions_like', type: 'bigint', nullable: true })
  reactionsLike!: string | null;

  @Column({ name: 'reactions_love', type: 'bigint', nullable: true })
  reactionsLove!: string | null;

  @Column({ name: 'reactions_wow', type: 'bigint', nullable: true })
  reactionsWow!: string | null;

  @Column({ name: 'reactions_haha', type: 'bigint', nullable: true })
  reactionsHaha!: string | null;

  /** Meta's own name for the "sad" reaction. */
  @Column({ name: 'reactions_sorry', type: 'bigint', nullable: true })
  reactionsSorry!: string | null;

  @Column({ name: 'reactions_anger', type: 'bigint', nullable: true })
  reactionsAnger!: string | null;

  /**
   * `post_media_view` split by `is_from_ads`, as a lifetime total.
   *
   * Facebook only, and the split is real rather than derived: Meta returns both
   * buckets in the same response, so the paid figure is its own measurement and
   * never `total - organic`.
   *
   * A boosted post has both. Neither is a subset of `impressionsLifetime` in
   * any way worth relying on — they are the two buckets of that same total, and
   * on this edge they do add up, unlike Instagram's de-duplicated slices.
   */
  @Column({ name: 'views_organic_lifetime', type: 'bigint', nullable: true })
  viewsOrganicLifetime!: string | null;

  @Column({ name: 'views_paid_lifetime', type: 'bigint', nullable: true })
  viewsPaidLifetime!: string | null;

  /** True for same-day or provider-incomplete facts. */
  @Column({ name: 'is_partial', type: 'boolean', default: false })
  isPartial!: boolean;

  @Column({ name: 'synced_at', type: 'timestamptz', default: () => 'now()' })
  syncedAt!: Date;

  /** Pruning a run log must not delete the facts it produced. */
  @Column({ name: 'sync_run_id', type: 'uuid', nullable: true })
  syncRunId!: string | null;

  /** Provider-native metric names that have no normalized column. */
  @Column({
    name: 'provider_metrics',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  providerMetrics!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
