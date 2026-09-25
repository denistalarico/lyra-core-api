import { MetaOrganicStoriesService } from './meta-organic-stories.service';
import type { MetaOrganicGraphService } from '../../providers/meta/meta-organic-graph.service';
import type { SocialOrganicStoryWriterService } from '../social-organic-story-writer.service';
import type { OrganicStoryObservation } from '../social-organic-story-writer.service';
import type { ResolvedOrganicAnalyticsCredential } from '../../credentials/social-organic-credential.resolver';

/**
 * The story capture.
 *
 * What is really under test is failure behaviour, because that is where this
 * service differs from every other collector in the module. A story cannot be
 * re-read after 24 hours, so the pass is built to keep whatever it can get
 * rather than to be all-or-nothing — and the metric names it asks for could not
 * be verified against production, since the account has never had a story live
 * while one was being observed.
 */
describe('MetaOrganicStoriesService', () => {
  function harness(
    overrides: {
      listing?: unknown[];
      counters?: unknown;
      navigation?: unknown;
    } = {},
  ) {
    const written: OrganicStoryObservation[] = [];

    const graph = {
      listActiveStories: jest.fn(async () => ({
        data: overrides.listing ?? [],
        apiCalls: 1 as const,
      })),
      getOrganicInsights: jest.fn(async (input: { metrics: string[] }) => {
        const wantsNavigation = input.metrics.includes('navigation');
        const payload = wantsNavigation
          ? overrides.navigation
          : overrides.counters;

        if (payload instanceof Error) throw payload;

        return { data: (payload as unknown[]) ?? [], apiCalls: 1 as const };
      }),
    };

    const writer = {
      upsert: jest.fn(async (rows: readonly OrganicStoryObservation[]) => {
        written.push(...rows);
        return rows.length;
      }),
    };

    return {
      written,
      graph,
      writer,
      service: new MetaOrganicStoriesService(
        graph as unknown as MetaOrganicGraphService,
        writer as unknown as SocialOrganicStoryWriterService,
      ),
    };
  }

  const resolved = {
    assetTimezone: 'America/Sao_Paulo',
    credential: {
      provider: 'meta',
      assetType: 'instagram_professional',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: null,
      assetId: 'asset-1',
      externalAssetId: 'ig-1',
      accessToken: 'token',
    },
  } as unknown as ResolvedOrganicAnalyticsCredential;

  const story = {
    id: 'story-1',
    timestamp: '2026-09-24T11:00:00+0000',
    media_type: 'IMAGE',
    media_url: 'https://cdn.example/story.jpg',
    permalink: 'https://instagram.com/stories/1',
  };

  const counters = [
    { name: 'reach', values: [{ value: 120 }] },
    { name: 'views', values: [{ value: 145 }] },
    { name: 'replies', values: [{ value: 3 }] },
    { name: 'shares', values: [{ value: 2 }] },
    { name: 'total_interactions', values: [{ value: 5 }] },
    { name: 'profile_visits', values: [{ value: 4 }] },
    { name: 'follows', values: [{ value: 1 }] },
  ];

  const navigation = [
    {
      total_value: {
        breakdowns: [
          {
            dimension_keys: ['story_navigation_action_type'],
            results: [
              { dimension_values: ['tap_forward'], value: 60 },
              { dimension_values: ['swipe_forward'], value: 20 },
              { dimension_values: ['tap_back'], value: 7 },
              { dimension_values: ['tap_exit'], value: 11 },
            ],
          },
        ],
      },
    },
  ];

  it('stores a live story with its counters and its retention', async () => {
    const context = harness({ listing: [story], counters, navigation });

    const summary = await context.service.sync({
      resolved,
      syncRunId: 'run-1',
    });

    expect(summary).toMatchObject({ storiesSeen: 1, rowsWritten: 1 });
    expect(context.written[0]).toMatchObject({
      externalPublicationId: 'story-1',
      reach: '120',
      views: '145',
      replies: '3',
      shares: '2',
      totalInteractions: '5',
      profileVisits: '4',
      follows: '1',
      navForward: '60',
      navNextStory: '20',
      navBack: '7',
      navExit: '11',
    });
  });

  it('still stores the story when its counters are refused', async () => {
    // The point of the whole design. The creative and the timestamp cannot be
    // recovered once the story expires; a metric name can be corrected and
    // re-read on the next hourly pass. So a refusal must cost the counters, not
    // the row.
    const context = harness({
      listing: [story],
      counters: new Error('(#100) unsupported metric'),
      navigation,
    });

    const summary = await context.service.sync({ resolved, syncRunId: null });

    expect(summary.rowsWritten).toBe(1);
    expect(context.written[0]).toMatchObject({
      externalPublicationId: 'story-1',
      mediaUrl: 'https://cdn.example/story.jpg',
      reach: null,
      views: null,
      // Navigation was asked for separately, so losing the counters did not
      // lose it.
      navForward: '60',
    });
  });

  it('still stores the counters when navigation is refused', async () => {
    // `navigation` is the least verifiable metric here — it could not be
    // measured against production at all — so it is the most likely to be
    // wrong, and it is read in its own call precisely so that being wrong
    // costs only itself.
    const context = harness({
      listing: [story],
      counters,
      navigation: new Error('(#100) unsupported metric'),
    });

    await context.service.sync({ resolved, syncRunId: null });

    expect(context.written[0]).toMatchObject({
      reach: '120',
      navForward: null,
      navNextStory: null,
      navBack: null,
      navExit: null,
    });
  });

  it('ignores an unrecognised navigation action rather than folding it into a neighbour', async () => {
    // A wrong bucket is worse than an absent one: it looks like a measurement.
    const context = harness({
      listing: [story],
      counters,
      navigation: [
        {
          total_value: {
            breakdowns: [
              {
                dimension_keys: ['story_navigation_action_type'],
                results: [
                  { dimension_values: ['tap_forward'], value: 60 },
                  {
                    dimension_values: ['swipe_down_to_some_new_thing'],
                    value: 9,
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    await context.service.sync({ resolved, syncRunId: null });

    expect(context.written[0]).toMatchObject({
      navForward: '60',
      navNextStory: null,
      navBack: null,
      navExit: null,
    });
  });

  it('spends one call and writes nothing when no story is live', async () => {
    // The ordinary case on most accounts, most hours. It must be cheap, because
    // it runs every hour for every asset.
    const context = harness({ listing: [] });

    const summary = await context.service.sync({ resolved, syncRunId: null });

    expect(summary).toEqual({ storiesSeen: 0, rowsWritten: 0, apiCalls: 1 });
    expect(context.writer.upsert).not.toHaveBeenCalled();
  });

  it('spends nothing on a Facebook Page', async () => {
    // A Page's stories are a different product on a different edge. Asking here
    // would spend a call to be refused.
    const context = harness({ listing: [story] });

    const summary = await context.service.sync({
      resolved: {
        ...resolved,
        credential: { ...resolved.credential, assetType: 'facebook_page' },
      } as unknown as ResolvedOrganicAnalyticsCredential,
      syncRunId: null,
    });

    expect(summary.apiCalls).toBe(0);
    expect(context.graph.listActiveStories).not.toHaveBeenCalled();
  });

  it('skips a listing entry with no id rather than writing a row it cannot key', async () => {
    const context = harness({
      listing: [{ timestamp: '2026-09-24T11:00:00+0000' }, story],
      counters,
      navigation,
    });

    const summary = await context.service.sync({ resolved, syncRunId: null });

    expect(summary.storiesSeen).toBe(1);
    expect(context.written).toHaveLength(1);
  });
});
