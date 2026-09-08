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
