import type { SocialOrganicPostMetricDailyEntity } from '../entities/social-organic-post-metric-daily.entity';
import { toSocialOrganicPublicationMetricsView } from './social-organic-publication-metrics.view';

describe('toSocialOrganicPublicationMetricsView', () => {
  const observedAt = new Date('2026-09-18T12:30:00.000Z');

  it('keeps the latest lifetime snapshots separate from daily reach and shares', () => {
    const view = toSocialOrganicPublicationMetricsView({
      publicationId: '11111111-1111-4111-8111-111111111111',
      metricDate: '2026-09-18',
      syncedAt: observedAt,
      isPartial: true,
      videoViewsLifetime: '257',
      videoViewsLifetimeObservedAt: observedAt,
      impressionsLifetime: '999',
      impressionsLifetimeObservedAt: new Date('2026-09-17T12:30:00.000Z'),
      likesLifetime: '15',
      likesLifetimeObservedAt: observedAt,
      reach: '131',
      shares: '4',
    } as SocialOrganicPostMetricDailyEntity);

    expect(view).toEqual({
      publicationId: '11111111-1111-4111-8111-111111111111',
      metricDate: '2026-09-18',
      syncedAt: '2026-09-18T12:30:00.000Z',
      isPartial: true,
      views: '257',
      viewsGranularity: 'lifetime',
      viewsObservedAt: '2026-09-18T12:30:00.000Z',
      reach: '131',
      reachGranularity: 'daily',
      likes: '15',
      likesGranularity: 'lifetime',
      likesObservedAt: '2026-09-18T12:30:00.000Z',
      shares: '4',
      sharesGranularity: 'daily',
    });
  });

  it('falls back to the Facebook post-media-view snapshot without inventing missing data', () => {
    const view = toSocialOrganicPublicationMetricsView({
      publicationId: '11111111-1111-4111-8111-111111111111',
      metricDate: '2026-09-18',
      syncedAt: observedAt,
      isPartial: false,
      videoViewsLifetime: null,
      videoViewsLifetimeObservedAt: null,
      impressionsLifetime: '312',
      impressionsLifetimeObservedAt: observedAt,
      likesLifetime: null,
      likesLifetimeObservedAt: null,
      reach: null,
      shares: null,
    } as SocialOrganicPostMetricDailyEntity);

    expect(view.views).toBe('312');
    expect(view.viewsObservedAt).toBe('2026-09-18T12:30:00.000Z');
    expect(view.likes).toBeNull();
    expect(view.reach).toBeNull();
    expect(view.shares).toBeNull();
  });
});
