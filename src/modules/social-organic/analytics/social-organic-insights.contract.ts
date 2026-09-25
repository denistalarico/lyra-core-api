export type MetaOrganicAssetType = 'facebook_page' | 'instagram_professional';

export type NormalizedOrganicPostMetricDaily = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  provider: string;
  source: 'organic';
  externalPublicationId: string;
  publicationId: string | null;
  metricDate: string;
  assetTimezone: string;
  impressions: string | null;
  reach: string | null;
  likes: string | null;
  comments: string | null;
  shares: string | null;
  saves: string | null;
  videoViews: string | null;
  watchTimeSeconds: string | null;
  linkClicks: string | null;
  profileVisits: string | null;
  /** SNAPSHOT counters, cumulative since publication. Never summed. */
  reachLifetime: string | null;
  savesLifetime: string | null;
  sharesLifetime: string | null;
  totalInteractionsLifetime: string | null;
  profileVisitsLifetime: string | null;
  followsLifetime: string | null;
  /** One instant for the six counters above — one request observes them all. */
  lifetimeObservedAt: Date | null;
  /** Stable public URL. The image URL expires, so it is never stored. */
  permalink: string | null;
  caption: string | null;
  mediaType: string | null;
  mediaProductType: string | null;
  /** The provider's publish time, not the observation day. */
  publishedAt: Date | null;
  /** SNAPSHOT, not flow — see the entity docblock. Never summed across days. */
  impressionsLifetime: string | null;
  impressionsLifetimeObservedAt: Date | null;
  likesLifetime: string | null;
  likesLifetimeObservedAt: Date | null;
  commentsLifetime: string | null;
  commentsLifetimeObservedAt: Date | null;
  videoViewsLifetime: string | null;
  videoViewsLifetimeObservedAt: Date | null;
  /**
   * Reel-only measures, null on every other surface.
   *
   * They are read from a different metric list than a feed post's, because Meta
   * refuses a whole request that names one metric the media's product type does
   * not support — see `INSTAGRAM_REEL_LIFETIME_METRICS`.
   *
   * `reelsSkipRateBp` is a percentage in **basis points** (66.1% → 6610), not a
   * counter; the other three are milliseconds and a count.
   */
  reelsAvgWatchTimeMs: string | null;
  reelsTotalWatchTimeMs: string | null;
  reelsSkipRateBp: string | null;
  repostsLifetime: string | null;
  /**
   * Facebook-only measures, null on every Instagram row.
   *
   * The six reactions come from `post_reactions_by_type_total`, which answers
   * with a map rather than a counter; `reactionsTotal` prefers the post's own
   * `reactions.summary.total_count`, which counts as of now while the map is a
   * lifetime figure including reactions since removed.
   *
   * The two view columns are the `is_from_ads` buckets of `post_media_view`.
   * Unlike Instagram's de-duplicated surface slices, these two do partition the
   * total — a view was served by an ad or it was not.
   */
  reactionsTotal: string | null;
  reactionsLike: string | null;
  reactionsLove: string | null;
  reactionsWow: string | null;
  reactionsHaha: string | null;
  reactionsSorry: string | null;
  reactionsAnger: string | null;
  viewsOrganicLifetime: string | null;
  viewsPaidLifetime: string | null;
  isPartial: boolean;
  syncedAt: Date;
  syncRunId: string;
  providerMetrics: Record<string, unknown>;
};

export type NormalizedOrganicAccountMetricDaily = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  provider: string;
  source: 'organic';
  metricDate: string;
  assetTimezone: string;
  followersCount: string | null;
  followersGained: string | null;
  followersLost: string | null;
  /** ORGANIC only — the `media_product_type` breakdown with `AD` excluded. */
  impressions: string | null;
  reach: string | null;
  /**
   * The account TOTAL for the day, ads included, as Meta de-duplicates it.
   *
   * From the same response as the two above, read at `total_value.value`
   * instead of from the breakdown. Never the sum of the slices and never
   * derived by subtracting them — see the entity docblock.
   */
  viewsTotal: string | null;
  reachTotal: string | null;
  profileViews: string | null;
  /** Daily flows, read from the same call as `profileViews`. */
  totalInteractions: string | null;
  /** Distinct accounts for THAT DAY — see the entity docblock before summing. */
  accountsEngaged: string | null;
  likes: string | null;
  comments: string | null;
  shares: string | null;
  saves: string | null;
  replies: string | null;
  /**
   * Facebook Page series, null on Instagram.
   *
   * `pageFollows` is the day's own follower level and is the only chartable
   * follower figure — `followersCount` above knows only "now" and is stamped
   * onto whichever day is being written. See the entity for the full reason.
   */
  pageFollows: string | null;
  pageDailyFollows: string | null;
  pageDailyUnfollows: string | null;
  /** Both halves of the `is_from_ads` split on `page_media_view`. */
  viewsOrganic: string | null;
  viewsPaid: string | null;
  newConversations: string | null;
  isPartial: boolean;
  syncedAt: Date;
  syncRunId: string;
  providerMetrics: Record<string, unknown>;
};

export type SocialOrganicInsightsSyncSummary = {
  postRows: readonly NormalizedOrganicPostMetricDaily[];
  accountRows: readonly NormalizedOrganicAccountMetricDaily[];
  rowsSkipped: number;
  apiCalls: number;
};
