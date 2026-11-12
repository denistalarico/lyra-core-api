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

const fact = (patch: Partial<SocialOrganicPostMetricDailyEntity> = {}) =>
  ({
    publicationId: 'publication',
    metricDate: '2026-11-11',
    syncedAt: new Date('2026-11-11T12:00:00Z'),
    videoViewsLifetime: null,
    impressionsLifetime: null,
    videoViewsLifetimeObservedAt: null,
    impressionsLifetimeObservedAt: null,
    likesLifetime: null,
    likesLifetimeObservedAt: null,
    reach: null,
    shares: null,
    reachLifetime: null,
    sharesLifetime: null,
    reactionsLike: null,
    ...patch,
  }) as SocialOrganicPostMetricDailyEntity;

describe('publication metrics projection', () => {
  it('reads synchronized lifetime reach and shares without dropping their grain', () => {
    const result = toSocialOrganicPublicationMetricsView(
      fact({
        reachLifetime: '321',
        sharesLifetime: '12',
        videoViewsLifetime: '900',
        likesLifetime: '42',
      }),
    );
    expect(result).toMatchObject({
      views: '900',
      reach: '321',
      reachGranularity: 'lifetime',
      likes: '42',
      shares: '12',
      sharesGranularity: 'lifetime',
    });
  });
  it('uses Facebook like reactions and preserves measured zero', () => {
    expect(
      toSocialOrganicPublicationMetricsView(
        fact({ provider: 'meta', reactionsLike: '7' }),
      ).likes,
    ).toBe('7');
    expect(
      toSocialOrganicPublicationMetricsView(
        fact({
          likesLifetime: '0',
          reactionsLike: '7',
          reachLifetime: '0',
          reach: '99',
        }),
      ),
    ).toMatchObject({ likes: '0', reach: '0' });
  });
  it('keeps absent metrics null and daily-only historical facts daily', () => {
    expect(toSocialOrganicPublicationMetricsView(fact())).toMatchObject({
      views: null,
      reach: null,
      likes: null,
      shares: null,
    });
    expect(
      toSocialOrganicPublicationMetricsView(fact({ reach: '30', shares: '2' })),
    ).toMatchObject({
      reach: '30',
      reachGranularity: 'daily',
      shares: '2',
      sharesGranularity: 'daily',
    });
  });
});
