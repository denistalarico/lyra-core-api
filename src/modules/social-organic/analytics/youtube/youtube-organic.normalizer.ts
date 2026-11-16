import type {
  NormalizedOrganicAccountMetricDaily,
  NormalizedOrganicPostMetricDaily,
} from '../social-organic-insights.contract';
import type {
  YoutubeReportRow,
  YoutubeVideoDetail,
} from './youtube-analytics.client';

/** D-I6/YT3: the latest two days still move at YouTube (≈48 h latency). */
export const YOUTUBE_PARTIAL_DAYS = 2;

type Base = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  assetTimezone: string;
  syncedAt: Date;
  syncRunId: string;
};

/** A non-negative integer string, or null when the report omitted the value. */
export function intOrNull(value: unknown): string | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (value === undefined || value === null || !Number.isFinite(n)) return null;
  return String(Math.max(0, Math.round(n)));
}

/** YouTube reports minutes; the tables keep seconds. */
export function minutesToSeconds(value: unknown): string | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (value === undefined || value === null || !Number.isFinite(n)) return null;
  return String(Math.max(0, Math.round(n * 60)));
}

/** Whether `day` is within the last `YOUTUBE_PARTIAL_DAYS` closed days. */
export function isPartialDay(
  day: string,
  today: string,
  shift: (day: string, amount: number) => string,
): boolean {
  return day >= shift(today, -YOUTUBE_PARTIAL_DAYS);
}

export function normalizeYoutubeAccountDay(
  base: Base,
  row: YoutubeReportRow,
  input: { partial: boolean; followersCount: string | null },
): NormalizedOrganicAccountMetricDaily {
  return {
    ...base,
    provider: 'youtube',
    source: 'organic',
    metricDate: String(row.day),
    followersCount: input.followersCount,
    followersGained: intOrNull(row.subscribersGained),
    followersLost: intOrNull(row.subscribersLost),
    impressions: null,
    reach: null,
    viewsTotal: intOrNull(row.views),
    reachTotal: null,
    profileViews: null,
    totalInteractions: null,
    accountsEngaged: null,
    likes: intOrNull(row.likes),
    comments: intOrNull(row.comments),
    shares: intOrNull(row.shares),
    saves: null,
    replies: null,
    pageFollows: null,
    pageDailyFollows: null,
    pageDailyUnfollows: null,
    viewsOrganic: null,
    viewsPaid: null,
    newConversations: null,
    watchTimeSeconds: minutesToSeconds(row.estimatedMinutesWatched),
    isPartial: input.partial,
    // The average is not additive: kept as evidence, never summed.
    providerMetrics: {
      engagedViews: intOrNull(row.engagedViews),
      averageViewDurationSeconds: intOrNull(row.averageViewDuration),
    },
  };
}

export function normalizeYoutubePostDay(
  base: Base,
  row: YoutubeReportRow,
  input: {
    day: string;
    partial: boolean;
    detail: YoutubeVideoDetail | undefined;
    publicationId: string | null;
  },
): NormalizedOrganicPostMetricDaily {
  const videoId = String(row.video);
  return {
    ...base,
    provider: 'youtube',
    source: 'organic',
    externalPublicationId: videoId,
    publicationId: input.publicationId,
    metricDate: input.day,
    impressions: null,
    reach: null,
    likes: intOrNull(row.likes),
    comments: intOrNull(row.comments),
    shares: intOrNull(row.shares),
    saves: null,
    videoViews: intOrNull(row.views),
    watchTimeSeconds: minutesToSeconds(row.estimatedMinutesWatched),
    linkClicks: null,
    profileVisits: null,
    reachLifetime: null,
    savesLifetime: null,
    sharesLifetime: null,
    totalInteractionsLifetime: null,
    profileVisitsLifetime: null,
    followsLifetime: null,
    lifetimeObservedAt: null,
    permalink: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    caption: input.detail?.title ?? null,
    mediaType: 'video',
    mediaProductType: null,
    publishedAt: input.detail?.publishedAt ?? null,
    impressionsLifetime: null,
    impressionsLifetimeObservedAt: null,
    likesLifetime: null,
    likesLifetimeObservedAt: null,
    commentsLifetime: null,
    commentsLifetimeObservedAt: null,
    videoViewsLifetime: null,
    videoViewsLifetimeObservedAt: null,
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
    isPartial: input.partial,
    providerMetrics: {
      averageViewDurationSeconds: intOrNull(row.averageViewDuration),
      engagedViews: intOrNull(row.engagedViews),
    },
  };
}
