import { MetaOrganicFacebookReelsService } from './meta-organic-facebook-reels.service';
import type { MetaOrganicGraphService } from '../../providers/meta/meta-organic-graph.service';
import type {
  OrganicFacebookReelObservation,
  SocialOrganicFacebookReelWriterService,
} from '../social-organic-facebook-reel-writer.service';
import type { ResolvedOrganicAnalyticsCredential } from '../../credentials/social-organic-credential.resolver';

/**
 * The Facebook reel collector.
 *
 * Two things are really under test. The first is that the pass keeps a reel
 * whose insights were refused — a reel is permanent, so the numbers can be
 * re-read, but a pass that threw would also lose the reels after it in the
 * loop. The second is the window, which this collector applies itself because
 * `/{page}/video_reels` ignores `since`/`until`, unlike every other listing in
 * the module.
 */
describe('MetaOrganicFacebookReelsService', () => {
  function harness(
    overrides: { listing?: unknown[]; insights?: unknown } = {},
  ) {
    const written: OrganicFacebookReelObservation[] = [];

    const graph = {
      listPageReels: jest.fn(async () => ({
        data: overrides.listing ?? [],
        apiCalls: 1 as const,
      })),
      getVideoInsights: jest.fn(async () => {
        if (overrides.insights instanceof Error) throw overrides.insights;

        return {
          data: (overrides.insights as unknown[]) ?? [],
          apiCalls: 1 as const,
        };
      }),
    };

    const writer = {
      upsert: jest.fn(async (rows: readonly OrganicFacebookReelObservation[]) => {
        written.push(...rows);
        return rows.length;
      }),
    };

    return {
      written,
      graph,
      writer,
      service: new MetaOrganicFacebookReelsService(
        graph as unknown as MetaOrganicGraphService,
        writer as unknown as SocialOrganicFacebookReelWriterService,
      ),
    };
  }

  const resolved = {
    assetTimezone: 'America/Sao_Paulo',
    credential: {
      provider: 'meta',
      assetType: 'facebook_page',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: null,
      assetId: 'asset-1',
      externalAssetId: 'page-1',
      accessToken: 'token',
    },
  } as unknown as ResolvedOrganicAnalyticsCredential;

  const reel = {
    id: 'reel-1',
    created_time: '2026-09-10T13:41:05+0000',
    description: 'Um reel',
    permalink_url: '/reel/reel-1/',
    picture: 'https://cdn.example/reel.jpg',
    length: 27.271,
    views: 5659,
    comments: { summary: { total_count: 2 } },
    likes: { summary: { total_count: 9 } },
  };

  // The shape production answered with on 2026-09-25. `post_impressions_unique`
  // is in here because the collector sends no `metric` parameter — that edge
  // returns the unique-viewer figure only when none is named, and refuses it
  // when it is. See `FACEBOOK_REEL_UNIQUE_VIEWERS_METRIC`.
  const insights = [
    { name: 'fb_reels_total_plays', values: [{ value: 5659 }] },
    { name: 'blue_reels_play_count', values: [{ value: 5285 }] },
    { name: 'fb_reels_replay_count', values: [{ value: 374 }] },
    { name: 'post_impressions_unique', values: [{ value: 6243 }] },
    { name: 'post_video_view_time', values: [{ value: 47678166 }] },
    { name: 'post_video_avg_time_watched', values: [{ value: 9023 }] },
    {
      name: 'post_video_likes_by_reaction_type',
      values: [{ value: { like: 12, love: 3 } }],
    },
    {
      name: 'post_video_social_actions',
      values: [{ value: { COMMENT: 2, SHARE: 4 } }],
    },
    { name: 'post_video_followers', values: [{ value: 1 }] },
    {
      name: 'post_video_retention_graph',
      values: [{ value: { '0': 0.9822, '1': 0.9841, '2': 0.8734 } }],
    },
  ];

  const window = { fromDate: '2026-09-01', toDate: '2026-09-30' };

  it('stores every figure the reel edge reports', async () => {
    const { service, written } = harness({ listing: [reel], insights });

    const summary = await service.sync({
      resolved,
      ...window,
      syncRunId: 'run-1',
    });

    expect(summary).toEqual({ reelsSeen: 1, rowsWritten: 1, apiCalls: 2 });

    const [row] = written;
    expect(row.plays).toBe('5659');
    expect(row.blueReelsPlays).toBe('5285');
    expect(row.replays).toBe('374');
    expect(row.uniqueViewers).toBe('6243');
    expect(row.totalWatchTimeMs).toBe('47678166');
    expect(row.avgWatchTimeMs).toBe('9023');
    expect(row.reactionsLike).toBe('12');
    expect(row.reactionsLove).toBe('3');
    // The map's own sum, across the six known types.
    expect(row.reactionsTotal).toBe('15');
    expect(row.comments).toBe('2');
    expect(row.shares).toBe('4');
    expect(row.newFollowers).toBe('1');
    expect(row.retentionGraph).toEqual({
      '0': 0.9822,
      '1': 0.9841,
      '2': 0.8734,
    });
    // Stored as Meta gives it — a path, not a URL. The view absolutizes it.
    expect(row.permalink).toBe('/reel/reel-1/');
    expect(row.lengthSeconds).toBe('27.271');
  });

  it('asks the reel edge for no metric in particular', async () => {
    const { service, graph } = harness({ listing: [reel], insights });

    await service.sync({ resolved, ...window, syncRunId: null });

    // Naming the metrics would cost `post_impressions_unique` — the only
    // unique-viewer figure left on the Facebook side, which this edge returns
    // when nothing is named and refuses when it is.
    expect(graph.getVideoInsights).toHaveBeenCalledWith(
      expect.not.objectContaining({ metrics: expect.anything() }),
    );
  });

  it('keeps the reel when Meta refuses its insights', async () => {
    const { service, written } = harness({
      listing: [reel],
      insights: new Error('(#100) refused'),
    });

    const summary = await service.sync({
      resolved,
      ...window,
      syncRunId: null,
    });

    // The refusal still cost a call, and it is counted.
    expect(summary).toEqual({ reelsSeen: 1, rowsWritten: 1, apiCalls: 2 });

    const [row] = written;
    // The listing's own figures survive: they came back before the refusal.
    expect(row.plays).toBe('5659');
    expect(row.reactionsTotal).toBe('9');
    expect(row.comments).toBe('2');
    // Everything only the insights edge knows is absent rather than zero.
    expect(row.uniqueViewers).toBeNull();
    expect(row.retentionGraph).toBeNull();
  });

  it('leaves out a reel published outside the window', async () => {
    const { service, writer } = harness({
      listing: [{ ...reel, created_time: '2026-02-13T13:41:05+0000' }],
      insights,
    });

    const summary = await service.sync({
      resolved,
      ...window,
      syncRunId: null,
    });

    // The listing call was spent; no insights call was, and nothing was written.
    expect(summary).toEqual({ reelsSeen: 0, rowsWritten: 0, apiCalls: 1 });
    expect(writer.upsert).not.toHaveBeenCalled();
  });

  it('spends no call at all on an Instagram asset', async () => {
    const { service, graph, writer } = harness({ listing: [reel], insights });

    const summary = await service.sync({
      resolved: {
        ...resolved,
        credential: {
          ...resolved.credential,
          assetType: 'instagram_professional',
        },
      } as unknown as ResolvedOrganicAnalyticsCredential,
      ...window,
      syncRunId: null,
    });

    expect(summary).toEqual({ reelsSeen: 0, rowsWritten: 0, apiCalls: 0 });
    expect(graph.listPageReels).not.toHaveBeenCalled();
    expect(writer.upsert).not.toHaveBeenCalled();
  });

  it('drops a retention point outside 0..1 rather than clamping it', async () => {
    const { service, written } = harness({
      listing: [reel],
      insights: [
        {
          name: 'post_video_retention_graph',
          // `1.4` is not a share of anything; keeping it would draw a line
          // above the top of the chart and look like a measurement.
          values: [{ value: { '0': 0.9, '1': 1.4, '2': -0.2, x: 0.5 } }],
        },
      ],
    });

    await service.sync({ resolved, ...window, syncRunId: null });

    expect(written[0].retentionGraph).toEqual({ '0': 0.9 });
  });

  it('ignores a listing entry with no id', async () => {
    const { service, writer } = harness({
      listing: [{ created_time: '2026-09-10T13:41:05+0000' }],
      insights,
    });

    const summary = await service.sync({
      resolved,
      ...window,
      syncRunId: null,
    });

    expect(summary.reelsSeen).toBe(0);
    expect(writer.upsert).not.toHaveBeenCalled();
  });

  it('keeps a reel Meta gave no timestamp for', async () => {
    const { service, written } = harness({
      listing: [{ ...reel, created_time: undefined }],
      insights,
    });

    // Excluding it would shrink the ranking because of a missing field the
    // reel does not control.
    await service.sync({ resolved, ...window, syncRunId: null });

    expect(written).toHaveLength(1);
    expect(written[0].publishedAt).toBeNull();
  });
});
