import type {
  NormalizedOrganicAccountMetricDaily,
  NormalizedOrganicPostMetricDaily,
} from '../social-organic-insights.contract';
import type {
  TiktokUserInfo,
  TiktokVideo,
} from '../../providers/tiktok/tiktok-api.client';

type Base = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  assetTimezone: string;
  syncedAt: Date;
  syncRunId: string;
};

/** A non-negative integer string, or null when TikTok omitted the value. */
export function tiktokCount(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return String(Math.max(0, Math.round(value)));
}

/**
 * D-I3: TikTok exposes no per-day flow for an account, only "now" counters.
 * The account row carries the follower stock on the observation day; every
 * other counter stays null, and the lifetime totals go in `providerMetrics`
 * (never summed).
 */
export function normalizeTiktokAccountDay(
  base: Base,
  user: TiktokUserInfo,
  day: string,
): NormalizedOrganicAccountMetricDaily {
  return {
    ...base,
    provider: 'tiktok',
    source: 'organic',
    metricDate: day,
    followersCount: tiktokCount(user.followerCount),
    followersGained: null,
    followersLost: null,
    impressions: null,
    reach: null,
    viewsTotal: null,
    reachTotal: null,
    profileViews: null,
    totalInteractions: null,
    accountsEngaged: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    replies: null,
    pageFollows: null,
    pageDailyFollows: null,
    pageDailyUnfollows: null,
    viewsOrganic: null,
    viewsPaid: null,
    newConversations: null,
    isPartial: false,
    providerMetrics: {
      followingCountSnapshot: tiktokCount(user.followingCount),
      likesCountSnapshot: tiktokCount(user.likesCount),
      videoCountSnapshot: tiktokCount(user.videoCount),
    },
  };
}

/** Counters of `video/list` are cumulative snapshots: only `*Lifetime` columns. */
export function normalizeTiktokPostDay(
  base: Base,
  video: TiktokVideo,
  input: { day: string; observedAt: Date; publicationId: string | null },
): NormalizedOrganicPostMetricDaily {
  const observed = (value: number | null) =>
    value === null ? null : input.observedAt;
  return {
    ...base,
    provider: 'tiktok',
    source: 'organic',
    externalPublicationId: video.id,
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
    reachLifetime: null,
    savesLifetime: null,
    sharesLifetime: tiktokCount(video.shareCount),
    totalInteractionsLifetime: null,
    profileVisitsLifetime: null,
    followsLifetime: null,
    lifetimeObservedAt: video.shareCount === null ? null : input.observedAt,
    permalink: video.shareUrl,
    caption: video.title,
    mediaType: 'video',
    mediaProductType: null,
    publishedAt:
      video.createTime === null ? null : new Date(video.createTime * 1000),
    impressionsLifetime: null,
    impressionsLifetimeObservedAt: null,
    likesLifetime: tiktokCount(video.likeCount),
    likesLifetimeObservedAt: observed(video.likeCount),
    commentsLifetime: tiktokCount(video.commentCount),
    commentsLifetimeObservedAt: observed(video.commentCount),
    videoViewsLifetime: tiktokCount(video.viewCount),
    videoViewsLifetimeObservedAt: observed(video.viewCount),
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
    providerMetrics: {},
  };
}
