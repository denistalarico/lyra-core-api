import type {
  NormalizedOrganicAccountMetricDaily,
  NormalizedOrganicPostMetricDaily,
} from '../social-organic-insights.contract';
import type {
  LinkedInDailyFollowerGain,
  LinkedInPostSummary,
  LinkedInShareStats,
} from '../../providers/linkedin/linkedin-organic-api.client';
import { linkedInPermalink } from '../../providers/linkedin/linkedin-publisher.adapter';

/** Follower statistics stop at D-2 (DOCUMENTED); share stats still move. */
export const LINKEDIN_PARTIAL_DAYS = 2;

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
 * A non-negative integer string. `likeCount` can go negative at LinkedIn
 * (an organic unlike of a sponsored like, DOCUMENTED); the table forbids it.
 */
export function linkedInCount(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return String(Math.max(0, Math.round(value)));
}

function sum(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

/** D-I3: one page day from share statistics, follower gains and the stock. */
export function normalizeLinkedInAccountDay(
  base: Base,
  input: {
    day: string;
    partial: boolean;
    stats: LinkedInShareStats | undefined;
    gains: LinkedInDailyFollowerGain | undefined;
    followersCount: number | null;
  },
): NormalizedOrganicAccountMetricDaily {
  const { stats, gains } = input;
  return {
    ...base,
    provider: 'linkedin',
    source: 'organic',
    metricDate: input.day,
    followersCount: linkedInCount(input.followersCount),
    followersGained: linkedInCount(
      sum(gains?.organic ?? null, gains?.paid ?? null),
    ),
    // LinkedIn reports gains only; losses are unknown, not zero.
    followersLost: null,
    impressions: linkedInCount(stats?.impressions),
    reach: linkedInCount(stats?.uniqueImpressions),
    viewsTotal: null,
    reachTotal: null,
    profileViews: null,
    totalInteractions: null,
    accountsEngaged: null,
    likes: linkedInCount(stats?.likes),
    comments: linkedInCount(stats?.comments),
    shares: linkedInCount(stats?.shares),
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
      clicks: linkedInCount(stats?.clicks),
      engagement: stats?.engagement ?? null,
      organicFollowerGain: linkedInCount(gains?.organic),
      paidFollowerGain: linkedInCount(gains?.paid),
    },
  };
}

/** Per-post statistics are lifetime snapshots: only `*Lifetime` columns. */
export function normalizeLinkedInPostDay(
  base: Base,
  post: LinkedInPostSummary,
  input: {
    day: string;
    observedAt: Date;
    stats: LinkedInShareStats | undefined;
    publicationId: string | null;
  },
): NormalizedOrganicPostMetricDaily {
  // Absent from the response means no activity: zero (DOCUMENTED).
  const stats = input.stats;
  const count = (value: number | null | undefined) =>
    linkedInCount(stats ? value : 0) ?? '0';
  const at = input.observedAt;
  const published = post.publishedAt ?? post.createdAt;
  return {
    ...base,
    provider: 'linkedin',
    source: 'organic',
    externalPublicationId: post.urn,
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
    sharesLifetime: count(stats?.shares),
    totalInteractionsLifetime: null,
    profileVisitsLifetime: null,
    followsLifetime: null,
    lifetimeObservedAt: at,
    permalink: linkedInPermalink(post.urn),
    caption: post.commentary,
    mediaType: null,
    mediaProductType: null,
    publishedAt: published === null ? null : new Date(published),
    impressionsLifetime: count(stats?.impressions),
    impressionsLifetimeObservedAt: at,
    likesLifetime: count(stats?.likes),
    likesLifetimeObservedAt: at,
    commentsLifetime: count(stats?.comments),
    commentsLifetimeObservedAt: at,
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
    isPartial: false,
    providerMetrics: {
      clicksLifetime: count(stats?.clicks),
      uniqueImpressionsLifetime: linkedInCount(stats?.uniqueImpressions),
      engagement: stats?.engagement ?? null,
    },
  };
}
