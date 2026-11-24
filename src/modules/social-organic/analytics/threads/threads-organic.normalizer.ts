import type {
  NormalizedOrganicAccountMetricDaily,
  NormalizedOrganicPostMetricDaily,
} from '../social-organic-insights.contract';
import type {
  ThreadsPost,
  ThreadsPostInsights,
} from '../../providers/threads/threads-api.client';
import { THREADS_PROVIDER } from '../../providers/threads/threads-capabilities';

type Base = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  assetTimezone: string;
  syncedAt: Date;
  syncRunId: string;
};

/** One day of the profile, as the provider assembled it. */
export type ThreadsAccountDay = {
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  clicks: number | null;
};

const whole = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? null
    : Math.max(0, Math.round(value));
const counter = (value: number | null | undefined) => {
  const rounded = whole(value);
  return rounded === null ? null : String(rounded);
};

/** The sum only when every part is known; a missing part is not a zero. */
function sumAll(values: Array<number | null | undefined>): string | null {
  let total = 0;
  for (const value of values) {
    const rounded = whole(value);
    if (rounded === null) return null;
    total += rounded;
  }
  return String(total);
}

/**
 * Column mapping (Threads has no saves, reach or profile views):
 * views → `viewsTotal` (read by `threads_views` via `channel_views`),
 * replies → `comments`, reposts → `shares`; quotes and link clicks stay in
 * `providerMetrics`. Interactions = likes + replies + reposts + quotes, only
 * when Threads answered all four.
 */
export function normalizeThreadsAccountDay(
  base: Base,
  input: {
    day: string;
    partial: boolean;
    metrics: ThreadsAccountDay;
    followersCount: number | null;
  },
): NormalizedOrganicAccountMetricDaily {
  const { metrics } = input;
  const likes = counter(metrics.likes);
  const replies = counter(metrics.replies);
  const reposts = counter(metrics.reposts);
  const quotes = counter(metrics.quotes);
  const interactions = sumAll([
    metrics.likes,
    metrics.replies,
    metrics.reposts,
    metrics.quotes,
  ]);
  return {
    ...base,
    provider: THREADS_PROVIDER,
    source: 'organic',
    metricDate: input.day,
    followersCount: counter(input.followersCount),
    followersGained: null,
    followersLost: null,
    impressions: null,
    reach: null,
    viewsTotal: counter(metrics.views),
    reachTotal: null,
    profileViews: null,
    totalInteractions: interactions,
    accountsEngaged: null,
    likes,
    comments: replies,
    shares: reposts,
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
      quotes,
      linkClicks: counter(metrics.clicks),
    },
  };
}

/** Post counters are lifetime totals: only `*Lifetime` columns. */
export function normalizeThreadsPostDay(
  base: Base,
  post: ThreadsPost,
  insights: ThreadsPostInsights,
  input: { day: string; observedAt: Date; publicationId: string | null },
): NormalizedOrganicPostMetricDaily {
  const at = input.observedAt;
  const observed = (value: number | null) => (value === null ? null : at);
  const publishedAt = post.timestamp ? new Date(post.timestamp) : null;
  return {
    ...base,
    provider: THREADS_PROVIDER,
    source: 'organic',
    externalPublicationId: post.id,
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
    sharesLifetime: counter(insights.shares),
    totalInteractionsLifetime: null,
    profileVisitsLifetime: null,
    followsLifetime: null,
    lifetimeObservedAt: at,
    permalink: post.permalink,
    caption: post.text,
    mediaType: post.mediaType ? post.mediaType.toLowerCase() : null,
    mediaProductType: null,
    publishedAt:
      publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
    impressionsLifetime: null,
    impressionsLifetimeObservedAt: null,
    likesLifetime: counter(insights.likes),
    likesLifetimeObservedAt: observed(insights.likes),
    commentsLifetime: counter(insights.replies),
    commentsLifetimeObservedAt: observed(insights.replies),
    videoViewsLifetime: counter(insights.views),
    videoViewsLifetimeObservedAt: observed(insights.views),
    reelsAvgWatchTimeMs: null,
    reelsTotalWatchTimeMs: null,
    reelsSkipRateBp: null,
    repostsLifetime: counter(insights.reposts),
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
    providerMetrics: { quotes: counter(insights.quotes) },
  };
}
