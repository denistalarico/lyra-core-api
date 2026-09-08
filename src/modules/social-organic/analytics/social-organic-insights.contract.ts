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
