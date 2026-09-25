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

type PublishedPostRow = {
  id: string;
  external_publication_id: string;
  /** The surface. Defaults to a feed post, which is what most tests want. */
  media_product_type?: string;
};

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
  // Discovery is provider-side now, so the listing is mocked here rather than
  // through `dataSource`. Empty by default, which is what keeps the
  // account-only tests free of any post-level mocking.
  const listPublishedPosts = jest.fn<
    ReturnType<MetaOrganicGraphService['listPublishedPosts']>,
    Parameters<MetaOrganicGraphService['listPublishedPosts']>
  >(async () => ({
    data: (options.publishedPosts ?? []).map((row) => ({
      id: row.external_publication_id,
      timestamp: '2026-09-08T10:00:00+0000',
      created_time: '2026-09-08T10:00:00+0000',
      permalink: `https://example.test/${row.external_publication_id}`,
      permalink_url: `https://example.test/${row.external_publication_id}`,
      media_type: 'IMAGE',
      media_product_type: row.media_product_type ?? 'FEED',
      caption: 'legenda',
      message: 'legenda',
    })),
    apiCalls: 1 as const,
  }));
  // Shares, comments and reactions are post *fields*, read in their own call.
  // Mocked with real counts so the Facebook path exercises the reader rather
  // than falling into its try/catch — which passes either way, and would hide a
  // broken read behind a warning.
  const getPostEngagementFields = jest.fn(async () => ({
    data: {
      shares: { count: 6 },
      comments: { summary: { total_count: 4 } },
      reactions: { summary: { total_count: 9 } },
    },
    apiCalls: 1 as const,
  }));
  const graph = {
    getProfileFollowersCount,
    getOrganicInsights,
    listPublishedPosts,
    getPostEngagementFields,
  };
  type WriterInput = Parameters<SocialOrganicMetricsWriterService['upsert']>[0];
  const writer = {
    upsert: jest.fn(async (input: WriterInput) => ({
      postRows: input.postRows.length,
      accountRows: input.accountRows.length,
    })),
  };
  // Now only the back-join that resolves Lyra's own `publicationId` for a
  // discovered post. A post Lyra did not publish has no row, which is the
  // ordinary case — hence the empty default.
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
      })
      // The engagement family: no breakdown, so each metric is a bare
      // `total_value.value` and all of them share one request.
      .mockResolvedValueOnce({
        data: [
          { name: 'profile_views', period: 'day', total_value: { value: 7 } },
          {
            name: 'accounts_engaged',
            period: 'day',
            total_value: { value: 4 },
          },
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
    // The engagement read is one request for the whole family, which is what
    // keeps this at three calls a day rather than one per counter.
    expect(graph.getOrganicInsights).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        metrics: expect.arrayContaining(['profile_views', 'accounts_engaged']),
        metricType: 'total_value',
      }),
    );
    expect(summary.accountRows[0]).toMatchObject({
      impressions: '12',
      reach: '5',
      followersGained: '2',
      followersLost: '1',
      followersCount: null,
      profileViews: '7',
      metricDate: '2026-09-07',
      isPartial: false,
    });
    expect(summary.apiCalls).toBe(3);
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
          // `is_from_ads` splits the view total in the same response. The
          // reaction map cannot ride along: it does not accept that breakdown
          // and Meta refuses the whole request, so it is call #2.
          metrics: ['post_media_view'],
          period: 'lifetime',
          breakdown: 'is_from_ads',
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

    it('unpacks the reaction map, the ad split and the post fields', async () => {
      const { service, graph } = harness({
        publishedPosts: [{ id: 'pub-1', external_publication_id: 'post-1' }],
      });
      graph.getOrganicInsights.mockResolvedValueOnce({
        data: [
          {
            name: 'post_media_view',
            period: 'lifetime',
            // Meta spells the buckets as strings, and they *do* partition the
            // total here — unlike Instagram's de-duplicated surface slices.
            values: [
              { value: 30, is_from_ads: '0' },
              { value: 12, is_from_ads: '1' },
            ],
          },
        ],
        apiCalls: 1,
      });
      // Call #2: the reaction map, in a request of its own.
      graph.getOrganicInsights.mockResolvedValueOnce({
        data: [
          {
            name: 'post_reactions_by_type_total',
            period: 'lifetime',
            values: [{ value: { like: 5, love: 2, anger: 1 } }],
          },
        ],
        apiCalls: 1,
      });
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

      expect(summary.postRows[0]).toMatchObject({
        viewsOrganicLifetime: '30',
        viewsPaidLifetime: '12',
        reactionsLike: '5',
        reactionsLove: '2',
        reactionsAnger: '1',
        // A type Meta omitted is a measured zero, not a null: the map came
        // back, it simply had no `wow` in it.
        reactionsWow: '0',
        // The summary count wins over the map's sum of 8. Meta counts the
        // summary as of now while the map is a lifetime total that still
        // includes reactions since removed.
        reactionsTotal: '9',
        commentsLifetime: '4',
        sharesLifetime: '6',
      });
    });

    it('still writes a Facebook post when its engagement fields are refused', async () => {
      const { service, graph } = harness({
        publishedPosts: [{ id: 'pub-1', external_publication_id: 'post-1' }],
      });
      graph.getPostEngagementFields.mockRejectedValueOnce(
        new Error('(#100) refused'),
      );
      graph.getOrganicInsights.mockResolvedValueOnce({
        data: [
          {
            name: 'post_media_view',
            period: 'lifetime',
            values: [{ value: 42 }],
          },
        ],
        apiCalls: 1,
      });
      graph.getOrganicInsights.mockResolvedValueOnce({ data: [], apiCalls: 1 });
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

      // The insights are the measurement that matters; losing the fields costs
      // three columns, not the row.
      expect(summary.postRows).toHaveLength(1);
      expect(summary.postRows[0]).toMatchObject({
        impressionsLifetime: '42',
        commentsLifetime: null,
        sharesLifetime: null,
      });
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
          // The ranking counters joined the batch; still one request per post.
          metrics: [
            'comments',
            'likes',
            'views',
            'reach',
            'saved',
            'shares',
            'total_interactions',
            'profile_visits',
            'follows',
          ],
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

    it('asks a reel for the metrics a reel has, not a feed post’s', async () => {
      // The production bug this fixes. Meta rejects the *whole* request when
      // one metric does not apply to the media's product type: a reel asked for
      // `profile_visits, follows` answers `(#100) The Media Insights API does
      // not support the profile_visits, follows metric for this media product
      // type` and returns nothing at all — not the seven it does support.
      //
      // Because the sync sent one list for every post, every reel's call failed
      // and no reel ever produced a row. Verified against an account with 65
      // reels and 313 feed posts whose fact table held three feed posts and no
      // reels. It survived because an empty table looks exactly like an account
      // that does not post reels.
      const { service, graph } = harness({
        publishedPosts: [
          {
            id: 'pub-reel',
            external_publication_id: 'reel-1',
            media_product_type: 'REELS',
          },
        ],
      });
      graph.getOrganicInsights.mockResolvedValueOnce({
        data: [
          { name: 'reach', period: 'lifetime', values: [{ value: 323 }] },
          { name: 'views', period: 'lifetime', values: [{ value: 512 }] },
          { name: 'likes', period: 'lifetime', values: [{ value: 13 }] },
          {
            name: 'ig_reels_avg_watch_time',
            period: 'lifetime',
            values: [{ value: 8084 }],
          },
          {
            name: 'ig_reels_video_view_total_time',
            period: 'lifetime',
            values: [{ value: 3144797 }],
          },
          {
            name: 'reels_skip_rate',
            period: 'lifetime',
            values: [{ value: 66.1 }],
          },
          { name: 'reposts', period: 'lifetime', values: [{ value: 0 }] },
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

      const asked = graph.getOrganicInsights.mock.calls[0][0];
      expect(asked.metrics).not.toContain('profile_visits');
      expect(asked.metrics).not.toContain('follows');
      expect(asked.metrics).toContain('ig_reels_avg_watch_time');
      expect(asked.metrics).toContain('reels_skip_rate');

      // The figures are the ones measured against the live account on
      // 2026-09-24, so a mis-mapped metric name shows up as a moved value.
      expect(summary.postRows[0]).toMatchObject({
        externalPublicationId: 'reel-1',
        reachLifetime: '323',
        videoViewsLifetime: '512',
        likesLifetime: '13',
        reelsAvgWatchTimeMs: '8084',
        reelsTotalWatchTimeMs: '3144797',
        // 66.1% as basis points: this column is not a counter, and the fact
        // table stores no ratio as a ratio.
        reelsSkipRateBp: '6610',
        repostsLifetime: '0',
        // Asked for and genuinely unavailable on this surface, so null rather
        // than zero — the two are different claims.
        profileVisitsLifetime: null,
        followsLifetime: null,
      });
    });

    it('writes a reel row even when only its watch times came back', async () => {
      // A reel whose only readable numbers are its watch times is still a reel
      // worth a row. Dropping it would leave the table saying the account
      // published nothing that day, which is the failure mode this whole change
      // is about.
      const { service, graph } = harness({
        publishedPosts: [
          {
            id: 'pub-reel',
            external_publication_id: 'reel-2',
            media_product_type: 'REEL',
          },
        ],
      });
      graph.getOrganicInsights.mockResolvedValueOnce({
        data: [
          {
            name: 'ig_reels_avg_watch_time',
            period: 'lifetime',
            values: [{ value: 4000 }],
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
        externalPublicationId: 'reel-2',
        reelsAvgWatchTimeMs: '4000',
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

    it('trusts discovery and does not filter posts again in memory', async () => {
      // Same guarantee as before, now that discovery is provider-side: the
      // window is passed to Meta as `since`/`until`, so an empty listing means
      // no posts and the service adds no second filter of its own. With nothing
      // discovered it also never issues the publication back-join, which is the
      // only thing `dataSource.query` is still used for here.
      const { service, graph, dataSource } = harness({ publishedPosts: [] });

      const summary = await service.sync({
        resolved: resolved('facebook_page'),
        fromDate: '2026-09-08',
        toDate: '2026-09-08',
        syncRunId: 'run-1',
        syncedAt: new Date('2026-09-08T15:00:00.000Z'),
      });

      expect(graph.listPublishedPosts).toHaveBeenCalledWith(
        expect.objectContaining({
          objectId: 'page-1',
          assetType: 'facebook_page',
          since: expect.any(Number),
          until: expect.any(Number),
        }),
      );
      expect(dataSource.query).not.toHaveBeenCalled();
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
