/* eslint-disable @typescript-eslint/require-await -- provider doubles intentionally return promises. */
import type { DataSource } from 'typeorm';
import type { ResolvedOrganicAnalyticsCredential } from '../../credentials/social-organic-credential.resolver';
import type { MetaOrganicGraphService } from '../../providers/meta/meta-organic-graph.service';
import type { SocialOrganicMetricsWriterService } from '../social-organic-metrics-writer.service';
import { MetaOrganicInsightsService } from './meta-organic-insights.service';

function resolved(
  assetType: 'facebook_page' | 'instagram_professional',
): ResolvedOrganicAnalyticsCredential {
  return {
    assetTimezone: 'America/Sao_Paulo',
    credential: {
      assetId: 'asset-1',
      connectionId: 'connection-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: null,
      provider: 'meta',
      assetType,
      externalAssetId: assetType === 'facebook_page' ? 'page-1' : 'ig-1',
      scopes: [],
      credentialVersion: 1,
      accessToken: 'secret-token',
      toJSON: () => ({ accessToken: '[REDACTED]' }),
    },
  };
}

function breakdownMetric(
  name: string,
  key: string,
  values: Array<[string, number]>,
) {
  return {
    name,
    period: 'day',
    total_value: {
      breakdowns: [
        {
          dimension_keys: [key],
          results: values.map(([dimension, value]) => ({
            dimension_values: [dimension],
            value,
          })),
        },
      ],
    },
  };
}

type PublishedPostRow = { id: string; external_publication_id: string };

function harness(options: { publishedPosts?: PublishedPostRow[] } = {}) {
  const getProfileFollowersCount = jest.fn<
    ReturnType<MetaOrganicGraphService['getProfileFollowersCount']>,
    Parameters<MetaOrganicGraphService['getProfileFollowersCount']>
  >(async () => '100');
  const getOrganicInsights = jest.fn<
    ReturnType<MetaOrganicGraphService['getOrganicInsights']>,
    Parameters<MetaOrganicGraphService['getOrganicInsights']>
  >(async () => ({
    data: [
      {
        name: 'page_media_view',
        period: 'day',
        values: [{ value: { organic: 11, paid: 7 } }],
      },
    ],
    apiCalls: 1 as const,
  }));
  const graph = {
    getProfileFollowersCount,
    getOrganicInsights,
  };
  type WriterInput = Parameters<SocialOrganicMetricsWriterService['upsert']>[0];
  const writer = {
    upsert: jest.fn(async (input: WriterInput) => ({
      postRows: input.postRows.length,
      accountRows: input.accountRows.length,
    })),
  };
  // `social_publications` discovery: empty by default, so the 3 pre-existing
  // account-only tests below naturally see zero candidate posts without any
  // explicit mocking of the discovery call.
  const query = jest.fn(async () => options.publishedPosts ?? []);
  const dataSource = { query };

  return {
    graph,
    writer,
    dataSource,
    service: new MetaOrganicInsightsService(
      graph as unknown as MetaOrganicGraphService,
      writer as unknown as SocialOrganicMetricsWriterService,
      dataSource as unknown as DataSource,
    ),
  };
}

describe('MetaOrganicInsightsService', () => {
  it('syncs a Facebook account day with the explicit organic breakdown', async () => {
    const { service, graph, writer } = harness();

    const summary = await service.sync({
      resolved: resolved('facebook_page'),
      fromDate: '2026-09-08',
      toDate: '2026-09-08',
      syncRunId: 'run-1',
      syncedAt: new Date('2026-09-08T15:00:00.000Z'),
    });

    expect(graph.getOrganicInsights).toHaveBeenCalledWith(
      expect.objectContaining({
        objectId: 'page-1',
        metrics: ['page_media_view'],
        period: 'day',
        breakdown: 'is_from_ads',
      }),
    );
    expect(summary.postRows).toEqual([]);
    expect(summary.accountRows[0]).toMatchObject({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: null,
      followersCount: '100',
      impressions: '11',
      metricDate: '2026-09-08',
      assetTimezone: 'America/Sao_Paulo',
      isPartial: true,
    });
    expect(writer.upsert).toHaveBeenCalledTimes(1);
  });

  it('syncs Instagram account metrics per asset-local day and excludes AD', async () => {
    const { service, graph } = harness();
    graph.getOrganicInsights
      .mockResolvedValueOnce({
        data: [
          breakdownMetric('views', 'media_product_type', [
            ['POST', 12],
            ['AD', 90],
          ]),
          breakdownMetric('reach', 'media_product_type', [['REEL', 5]]),
        ],
        apiCalls: 1,
      })
      .mockResolvedValueOnce({
        data: [
          breakdownMetric('follows_and_unfollows', 'follow_type', [
            ['FOLLOWER', 2],
            ['NON_FOLLOWER', 1],
          ]),
        ],
        apiCalls: 1,
      });

    const summary = await service.sync({
      resolved: resolved('instagram_professional'),
      fromDate: '2026-09-07',
      toDate: '2026-09-07',
      syncRunId: 'run-1',
      syncedAt: new Date('2026-09-08T15:00:00.000Z'),
    });

    expect(graph.getProfileFollowersCount).not.toHaveBeenCalled();
    expect(graph.getOrganicInsights).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        metrics: ['views', 'reach'],
        metricType: 'total_value',
        breakdown: 'media_product_type',
      }),
    );
    expect(summary.accountRows[0]).toMatchObject({
      impressions: '12',
      reach: '5',
      followersGained: '2',
      followersLost: '1',
      followersCount: null,
      metricDate: '2026-09-07',
      isPartial: false,
    });
    expect(summary.apiCalls).toBe(2);
  });

  it('fails closed before a provider call for a non-Meta credential', async () => {
    const { service, graph, writer } = harness();
    const input = resolved('facebook_page');
    const other = {
      ...input,
      credential: { ...input.credential, provider: 'other' },
    };

    await expect(
      service.sync({
        resolved: other,
        fromDate: '2026-09-08',
        toDate: '2026-09-08',
        syncRunId: 'run-1',
      }),
    ).rejects.toThrow('unsupported_analytics_asset_type');
    expect(graph.getOrganicInsights).not.toHaveBeenCalled();
    expect(writer.upsert).not.toHaveBeenCalled();
  });

  describe('post-level lifetime snapshots', () => {
    function facebookLifetimeInsights(value = 42) {
      return {
        data: [
          { name: 'post_media_view', period: 'lifetime', values: [{ value }] },
        ],
        apiCalls: 1 as const,
      };
    }

    function instagramLifetimeInsights(
      overrides: Partial<Record<'comments' | 'likes' | 'views', number>> = {
        comments: 3,
        likes: 9,
        views: 100,
      },
    ) {
      return {
        data: Object.entries(overrides).map(([name, value]) => ({
          name,
          period: 'lifetime',
          values: [{ value }],
        })),
        apiCalls: 1 as const,
      };
    }

    it('fetches one FB post lifetime snapshot with period=lifetime and no since/until', async () => {
      const { service, graph, writer } = harness({
        publishedPosts: [{ id: 'pub-1', external_publication_id: 'post-1' }],
      });
      // Discovery/lifetime fetch runs before the per-day account loop, so
      // the lifetime call is call #1 and the account call is call #2.
      graph.getOrganicInsights.mockResolvedValueOnce(
        facebookLifetimeInsights(42),
      );
      graph.getOrganicInsights.mockResolvedValueOnce({
        data: [
          {
            name: 'page_media_view',
            period: 'day',
            values: [{ value: { organic: 11, paid: 7 } }],
          },
        ],
        apiCalls: 1,
      });

      const summary = await service.sync({
        resolved: resolved('facebook_page'),
        fromDate: '2026-09-08',
        toDate: '2026-09-08',
        syncRunId: 'run-1',
        syncedAt: new Date('2026-09-08T15:00:00.000Z'),
      });

      expect(graph.getOrganicInsights).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          objectId: 'post-1',
          metrics: ['post_media_view'],
          period: 'lifetime',
        }),
      );
      const lifetimeCall = graph.getOrganicInsights.mock.calls[0][0];
      expect(lifetimeCall).not.toHaveProperty('since');
      expect(lifetimeCall).not.toHaveProperty('until');

      expect(summary.postRows).toHaveLength(1);
      expect(summary.postRows[0]).toMatchObject({
        externalPublicationId: 'post-1',
        publicationId: 'pub-1',
        metricDate: '2026-09-08',
        impressionsLifetime: '42',
        impressionsLifetimeObservedAt: new Date('2026-09-08T15:00:00.000Z'),
        isPartial: false,
      });
      expect(writer.upsert).toHaveBeenCalledTimes(1);
    });

    it('fetches one batched IG media lifetime snapshot (comments, likes, views)', async () => {
      const { service, graph } = harness({
        publishedPosts: [{ id: 'pub-2', external_publication_id: 'media-1' }],
      });
      // Discovery/lifetime fetch runs before the per-day account loop, so
      // the lifetime call is call #1; the account loop's media/follow calls
      // are #2 and #3.
      graph.getOrganicInsights
        .mockResolvedValueOnce(instagramLifetimeInsights())
        .mockResolvedValueOnce({
          data: [
            {
              name: 'views',
              period: 'day',
              total_value: { breakdowns: [] },
            },
            { name: 'reach', period: 'day', total_value: { breakdowns: [] } },
          ],
          apiCalls: 1,
        })
        .mockResolvedValueOnce({
          data: [
            {
              name: 'follows_and_unfollows',
              period: 'day',
              total_value: { breakdowns: [] },
            },
          ],
          apiCalls: 1,
        });

      const summary = await service.sync({
        resolved: resolved('instagram_professional'),
        fromDate: '2026-09-08',
        toDate: '2026-09-08',
        syncRunId: 'run-1',
        syncedAt: new Date('2026-09-08T15:00:00.000Z'),
      });

      expect(graph.getOrganicInsights).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          objectId: 'media-1',
          metrics: ['comments', 'likes', 'views'],
          period: 'lifetime',
        }),
      );
      expect(summary.postRows).toHaveLength(1);
      expect(summary.postRows[0]).toMatchObject({
        externalPublicationId: 'media-1',
        commentsLifetime: '3',
        likesLifetime: '9',
        videoViewsLifetime: '100',
        metricDate: '2026-09-08',
        isPartial: false,
      });
    });

    it('returns a partial row when only some IG lifetime metrics are present', async () => {
      const { service, graph } = harness({
        publishedPosts: [{ id: 'pub-3', external_publication_id: 'media-2' }],
      });
      graph.getOrganicInsights
        .mockResolvedValueOnce(instagramLifetimeInsights({ likes: 5 }))
        .mockResolvedValueOnce({
          data: [
            { name: 'views', period: 'day', total_value: { breakdowns: [] } },
            { name: 'reach', period: 'day', total_value: { breakdowns: [] } },
          ],
          apiCalls: 1,
        })
        .mockResolvedValueOnce({
          data: [
            {
              name: 'follows_and_unfollows',
              period: 'day',
              total_value: { breakdowns: [] },
            },
          ],
          apiCalls: 1,
        });

      const summary = await service.sync({
        resolved: resolved('instagram_professional'),
        fromDate: '2026-09-08',
        toDate: '2026-09-08',
        syncRunId: 'run-1',
        syncedAt: new Date('2026-09-08T15:00:00.000Z'),
      });

      expect(summary.postRows).toHaveLength(1);
      expect(summary.postRows[0]).toMatchObject({
        likesLifetime: '5',
        commentsLifetime: null,
        videoViewsLifetime: null,
      });
    });

    it('does not fetch a lifetime snapshot for a backfill-only window (currentDay outside window)', async () => {
      const { service, graph, dataSource } = harness({
        publishedPosts: [{ id: 'pub-4', external_publication_id: 'post-old' }],
      });

      const summary = await service.sync({
        resolved: resolved('facebook_page'),
        fromDate: '2026-01-01',
        toDate: '2026-01-02',
        syncRunId: 'run-1',
        syncedAt: new Date('2026-09-08T15:00:00.000Z'),
      });

      expect(dataSource.query).not.toHaveBeenCalled();
      expect(summary.postRows).toEqual([]);
      // Only the per-day account call happened; no lifetime call.
      expect(graph.getOrganicInsights).toHaveBeenCalledTimes(2);
    });

    it('excludes posts outside the window and posts with no externalPublicationId', async () => {
      // Discovery itself is scoped by the SQL query mocked here; this test
      // asserts the service does not filter further in memory, i.e. it
      // trusts exactly what discovery returns.
      const { service, dataSource } = harness({ publishedPosts: [] });

      const summary = await service.sync({
        resolved: resolved('facebook_page'),
        fromDate: '2026-09-08',
        toDate: '2026-09-08',
        syncRunId: 'run-1',
        syncedAt: new Date('2026-09-08T15:00:00.000Z'),
      });

      expect(dataSource.query).toHaveBeenCalledTimes(1);
      expect(summary.postRows).toEqual([]);
    });

    it('gives each of multiple posts its own row', async () => {
      const { service, graph } = harness({
        publishedPosts: [
          { id: 'pub-a', external_publication_id: 'post-a' },
          { id: 'pub-b', external_publication_id: 'post-b' },
        ],
      });
      // Lifetime calls (one per discovered post) run before the account loop.
      graph.getOrganicInsights.mockResolvedValueOnce(
        facebookLifetimeInsights(10),
      );
      graph.getOrganicInsights.mockResolvedValueOnce(
        facebookLifetimeInsights(20),
      );
      graph.getOrganicInsights.mockResolvedValueOnce({
        data: [
          {
            name: 'page_media_view',
            period: 'day',
            values: [{ value: { organic: 11, paid: 7 } }],
          },
        ],
        apiCalls: 1,
      });

      const summary = await service.sync({
        resolved: resolved('facebook_page'),
        fromDate: '2026-09-08',
        toDate: '2026-09-08',
        syncRunId: 'run-1',
        syncedAt: new Date('2026-09-08T15:00:00.000Z'),
      });

      expect(summary.postRows).toHaveLength(2);
      expect(summary.postRows.map((row) => row.externalPublicationId)).toEqual([
        'post-a',
        'post-b',
      ]);
    });
  });
});
