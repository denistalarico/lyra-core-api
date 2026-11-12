import type { SocialOrganicPostMetricDailyEntity } from '../entities/social-organic-post-metric-daily.entity';

/**
 * Latest locally-observed organic metrics for one Lyra publication.
 *
 * Views and likes are provider lifetime snapshots. Reach and shares prefer
 * synchronized lifetime snapshots, falling back to historical daily facts.
 * The explicit granularities keep consumers from adding
 * non-additive reach or treating a snapshot as a daily flow. Missing provider
 * values remain null, rather than becoming a misleading zero.
 */
export type SocialOrganicPublicationMetricsView = {
  publicationId: string;
  metricDate: string;
  syncedAt: string;
  isPartial: boolean;
  views: string | null;
  /** Facebook Reel counters retain their provider meanings. */
  plays?: string | null;
  uniqueViewers?: string | null;
  viewsGranularity: 'lifetime';
  viewsObservedAt: string | null;
  reach: string | null;
  reachGranularity: 'daily' | 'lifetime';
  likes: string | null;
  likesGranularity: 'lifetime';
  likesObservedAt: string | null;
  shares: string | null;
  sharesGranularity: 'daily' | 'lifetime';
};

export function toSocialOrganicPublicationMetricsView(
  fact: SocialOrganicPostMetricDailyEntity,
): SocialOrganicPublicationMetricsView {
  const views = fact.videoViewsLifetime ?? fact.impressionsLifetime;
  const viewsObservedAt =
    fact.videoViewsLifetimeObservedAt ?? fact.impressionsLifetimeObservedAt;

  return {
    publicationId: fact.publicationId!,
    metricDate: fact.metricDate,
    syncedAt: fact.syncedAt.toISOString(),
    isPartial: fact.isPartial,
    views,
    viewsGranularity: 'lifetime',
    viewsObservedAt: viewsObservedAt?.toISOString() ?? null,
    reach: fact.reachLifetime ?? fact.reach,
    reachGranularity: fact.reachLifetime != null ? 'lifetime' : 'daily',
    likes: fact.likesLifetime ?? fact.reactionsLike ?? null,
    likesGranularity: 'lifetime',
    likesObservedAt: fact.likesLifetimeObservedAt?.toISOString() ?? null,
    shares: fact.sharesLifetime ?? fact.shares,
    sharesGranularity: fact.sharesLifetime != null ? 'lifetime' : 'daily',
  };
}
