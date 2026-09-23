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
  impressions: string | null;
  reach: string | null;
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
