import type { DataSource, EntityManager } from 'typeorm';
import type {
  NormalizedOrganicAccountMetricDaily,
  NormalizedOrganicPostMetricDaily,
} from './social-organic-insights.contract';
import { SocialOrganicMetricsWriterService } from './social-organic-metrics-writer.service';

const base = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  agencyClientId: null,
  assetId: 'asset-1',
  provider: 'meta',
  source: 'organic' as const,
  metricDate: '2026-09-08',
  assetTimezone: 'America/Sao_Paulo',
  isPartial: true,
  syncedAt: new Date('2026-09-08T15:00:00.000Z'),
  syncRunId: 'run-1',
  providerMetrics: {},
};

const accountRow: NormalizedOrganicAccountMetricDaily = {
  ...base,
  followersCount: '9007199254740993',
  followersGained: null,
  followersLost: null,
  impressions: '10',
  reach: null,
  profileViews: null,
};

const postRow: NormalizedOrganicPostMetricDaily = {
  ...base,
  externalPublicationId: 'post-1',
  publicationId: null,
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
  impressionsLifetime: '42',
  impressionsLifetimeObservedAt: new Date('2026-09-08T15:00:00.000Z'),
  likesLifetime: null,
  likesLifetimeObservedAt: null,
  commentsLifetime: null,
  commentsLifetimeObservedAt: null,
  videoViewsLifetime: null,
  videoViewsLifetimeObservedAt: null,
};

describe('SocialOrganicMetricsWriterService', () => {
  it('uses one agency transaction and the A1 unique keys for convergence', async () => {
    const query = jest.fn(
      (sql: string, parameters: unknown[]): Promise<unknown[]> => {
        void sql;
        void parameters;
        return Promise.resolve([]);
      },
    );
    const dataSource = {
      transaction: jest.fn((work: (manager: EntityManager) => unknown) =>
        Promise.resolve(work({ query } as unknown as EntityManager)),
      ),
    };
    const service = new SocialOrganicMetricsWriterService(
      dataSource as unknown as DataSource,
    );

    await expect(
      service.upsert({ accountRows: [accountRow], postRows: [postRow] }),
    ).resolves.toEqual({ accountRows: 1, postRows: 1 });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain(
      'ON CONFLICT (asset_id, metric_date, source) DO UPDATE',
    );
    expect(query.mock.calls[1][0]).toContain(
      'ON CONFLICT (asset_id, external_publication_id, metric_date, source)',
    );
    expect(query.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        'tenant-1',
        'workspace-1',
        null,
        'America/Sao_Paulo',
        '9007199254740993',
      ]),
    );
    expect(query.mock.calls[1][0]).toContain(
      'impressions_lifetime = COALESCE(EXCLUDED.impressions_lifetime, social_organic_post_metrics_daily.impressions_lifetime)',
    );
    expect(query.mock.calls[1][0]).toContain(
      'likes_lifetime = COALESCE(EXCLUDED.likes_lifetime, social_organic_post_metrics_daily.likes_lifetime)',
    );
    expect(query.mock.calls[1][0]).toContain(
      'comments_lifetime = COALESCE(EXCLUDED.comments_lifetime, social_organic_post_metrics_daily.comments_lifetime)',
    );
    expect(query.mock.calls[1][0]).toContain(
      'video_views_lifetime = COALESCE(EXCLUDED.video_views_lifetime, social_organic_post_metrics_daily.video_views_lifetime)',
    );
    expect(query.mock.calls[1][1]).toEqual(
      expect.arrayContaining(['post-1', '42']),
    );
  });

  it('does no transaction for an empty provider response', async () => {
    const dataSource = { transaction: jest.fn() };
    const service = new SocialOrganicMetricsWriterService(
      dataSource as unknown as DataSource,
    );

    await expect(
      service.upsert({ accountRows: [], postRows: [] }),
    ).resolves.toEqual({ accountRows: 0, postRows: 0 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
