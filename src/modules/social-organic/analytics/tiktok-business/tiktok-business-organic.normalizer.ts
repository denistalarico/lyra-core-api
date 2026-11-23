import type {
  NormalizedOrganicAccountMetricDaily,
  NormalizedOrganicPostMetricDaily,
} from '../social-organic-insights.contract';
import type {
  TiktokBusinessAccountDay,
  TiktokBusinessVideo,
} from '../../providers/tiktok-business/tiktok-business-api.client';
import { TIKTOK_BUSINESS_PROVIDER } from '../../providers/tiktok-business/tiktok-business-capabilities';
import { tiktokCount } from '../tiktok/tiktok-organic.normalizer';

/** Daily metrics settle T + 24–48 h, UTC (DOCUMENTED): D-1 and D-2 partial. */
export const TIKTOK_BUSINESS_PARTIAL_DAYS = 2;

type Base = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  assetTimezone: string;
  syncedAt: Date;
  syncRunId: string;
};

/**
 * One UTC day of `/business/get/`. `video_views` counts organic and paid
 * plays (DOCUMENTED), so it goes to `viewsTotal`, never to the organic
 * `impressions`. `unique_video_views` is that day's distinct viewers (reach).
 * Gains/losses only exist for Advanced Access or Verified Business accounts:
 * absent stays null, never zero.
 */
export function normalizeTiktokBusinessAccountDay(
  base: Base,
  input: {
    day: string;
    partial: boolean;
    metrics: TiktokBusinessAccountDay | undefined;
    followersCount: number | null;
  },
): NormalizedOrganicAccountMetricDaily {
  const metrics = input.metrics;
  return {
    ...base,
    provider: TIKTOK_BUSINESS_PROVIDER,
    source: 'organic',
    metricDate: input.day,
    followersCount: tiktokCount(input.followersCount),
    followersGained: tiktokCount(metrics?.newFollowers),
    followersLost: tiktokCount(metrics?.lostFollowers),
    impressions: null,
    reach: tiktokCount(metrics?.uniqueVideoViews),
    viewsTotal: tiktokCount(metrics?.videoViews),
    reachTotal: null,
    profileViews: tiktokCount(metrics?.profileViews),
    totalInteractions: null,
    accountsEngaged: tiktokCount(metrics?.engagedAudience),
    likes: tiktokCount(metrics?.likes),
    comments: tiktokCount(metrics?.comments),
    shares: tiktokCount(metrics?.shares),
    saves: null,
    replies: null,
    pageFollows: null,
    pageDailyFollows: null,
    pageDailyUnfollows: null,
    viewsOrganic: null,
    viewsPaid: null,
    newConversations: null,
    isPartial: input.partial,
    providerMetrics: {
      // Net change can be negative; kept as reported, never in a count column.
      netFollowers:
        metrics?.netFollowers === null || metrics?.netFollowers === undefined
          ? null
          : Math.round(metrics.netFollowers),
      bioLinkClicks: tiktokCount(metrics?.bioLinkClicks),
    },
  };
}

/** Post counters are lifetime totals: only `*Lifetime` columns. */
export function normalizeTiktokBusinessPostDay(
  base: Base,
  video: TiktokBusinessVideo,
  input: { day: string; observedAt: Date; publicationId: string | null },
): NormalizedOrganicPostMetricDaily {
  const at = input.observedAt;
  const observed = (value: number | null) => (value === null ? null : at);
  const seconds = (value: number | null) =>
    value === null ? null : Math.round(value * 1000) / 1000;
  return {
    ...base,
    provider: TIKTOK_BUSINESS_PROVIDER,
    source: 'organic',
    externalPublicationId: video.itemId,
    publicationId: input.publicationId,
    metricDate: input.day,
    impressions: null,
    reach: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    videoViews: null,
    watchTimeSeconds: null,
    linkClicks: null,
    profileVisits: null,
    reachLifetime: tiktokCount(video.reach),
    savesLifetime: tiktokCount(video.favorites),
    sharesLifetime: tiktokCount(video.shares),
    totalInteractionsLifetime: null,
    profileVisitsLifetime: null,
    followsLifetime: tiktokCount(video.newFollowers),
    lifetimeObservedAt: at,
    permalink: video.shareUrl,
    caption: video.caption,
    mediaType: video.mediaType ? video.mediaType.toLowerCase() : null,
    mediaProductType: null,
    publishedAt:
      video.createTime === null ? null : new Date(video.createTime * 1000),
    impressionsLifetime: null,
    impressionsLifetimeObservedAt: null,
    likesLifetime: tiktokCount(video.likes),
    likesLifetimeObservedAt: observed(video.likes),
    commentsLifetime: tiktokCount(video.comments),
    commentsLifetimeObservedAt: observed(video.comments),
    videoViewsLifetime: tiktokCount(video.videoViews),
    videoViewsLifetimeObservedAt: observed(video.videoViews),
    reelsAvgWatchTimeMs: null,
    reelsTotalWatchTimeMs: null,
    reelsSkipRateBp: null,
    repostsLifetime: null,
    reactionsTotal: null,
    reactionsLike: null,
    reactionsLove: null,
    reactionsWow: null,
    reactionsHaha: null,
    reactionsSorry: null,
    reactionsAnger: null,
    viewsOrganicLifetime: null,
    viewsPaidLifetime: null,
    isPartial: false,
    providerMetrics: {
      totalTimeWatchedSeconds: seconds(video.totalTimeWatched),
      averageTimeWatchedSeconds: seconds(video.averageTimeWatched),
      fullVideoWatchedRate: video.fullVideoWatchedRate,
    },
  };
}
