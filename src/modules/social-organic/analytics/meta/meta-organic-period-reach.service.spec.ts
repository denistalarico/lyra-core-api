import { MetaOrganicPeriodReachService } from './meta-organic-period-reach.service';
import type { MetaOrganicGraphService } from '../../providers/meta/meta-organic-graph.service';
import type { ResolvedOrganicAnalyticsCredential } from '../../credentials/social-organic-credential.resolver';

/**
 * The period measurement: one range, de-duplicated by Meta rather than by us.
 *
 * What these tests defend is the arithmetic the service refuses to do. The
 * total is read, never summed from the slices; the paid slice is Meta's own
 * `AD` bucket, never `total - organic`. Both shortcuts look right and produce
 * numbers Meta never reported, and on the account this was written against the
 * difference is visible: 6 783 total against 6 645 paid and 156 organic, which
 * add to 6 801.
 */
describe('MetaOrganicPeriodReachService', () => {
  function instagram(): ResolvedOrganicAnalyticsCredential {
    return {
      credential: {
        assetType: 'instagram_professional',
        externalAssetId: 'ig-1',
        accessToken: 'token',
      },
    } as unknown as ResolvedOrganicAnalyticsCredential;
  }

  /** A response in the shape `measurePeriod` asks for: total plus slices. */
  function answer(total: number, surfaces: Array<[string, number]>) {
    return {
      apiCalls: 1,
      data: [
        {
          total_value: {
            value: total,
            breakdowns: [
              {
                dimension_keys: ['media_product_type'],
                results: surfaces.map(([dimension, value]) => ({
                  dimension_values: [dimension],
                  value,
                })),
              },
            ],
          },
        },
      ],
    };
  }

  function serviceWith(getOrganicInsights: jest.Mock) {
    return new MetaOrganicPeriodReachService({
      getOrganicInsights,
    } as unknown as MetaOrganicGraphService);
  }

  it('reads the total and both slices without deriving one from another', async () => {
    // The production figures from 2026-09-24. Note the slices do not add to the
    // total: Meta counts an account reached both ways once in the total and
    // once in each slice.
    const graph = jest.fn().mockImplementation(({ metrics }) =>
      metrics[0] === 'views'
        ? answer(9155, [
            ['POST', 123],
            ['STORY', 347],
            ['REEL', 20],
            ['CAROUSEL_CONTAINER', 19],
            ['AD', 8646],
          ])
        : answer(6783, [
            ['POST', 39],
            ['STORY', 105],
            ['REEL', 11],
            ['CAROUSEL_CONTAINER', 1],
            ['AD', 6645],
          ]),
    );

    const result = await serviceWith(graph).measurePeriod({
      resolved: instagram(),
      since: '2026-08-26',
      until: '2026-09-24',
    });

    expect(result).toMatchObject({
      views: '9155',
      viewsOrganic: '509',
      viewsPaid: '8646',
      reach: '6783',
      reachOrganic: '156',
      reachPaid: '6645',
      truncated: false,
    });

    // The assertion that matters: the total is Meta's, not our addition.
    expect(Number(result.reachOrganic) + Number(result.reachPaid)).toBe(6801);
    expect(result.reach).toBe('6783');
  });

  it('clamps a window wider than Meta allows and says that it did', async () => {
    // Verified against production: a 90-day range is refused outright with
    // `(#100) There cannot be more than 30 days`. Asking anyway spends a call
    // to get an error and leaves the card blank.
    const graph = jest.fn().mockResolvedValue(answer(10, [['POST', 10]]));

    const result = await serviceWith(graph).measurePeriod({
      resolved: instagram(),
      since: '2026-06-26',
      until: '2026-09-24',
    });

    expect(result.truncated).toBe(true);
    // The last 30 days, keeping the end the operator is asking about.
    expect(result.measuredSince).toBe('2026-08-26');
    expect(result.measuredUntil).toBe('2026-09-24');
  });

  it('leaves a window Meta accepts exactly as asked', async () => {
    const graph = jest.fn().mockResolvedValue(answer(10, [['POST', 10]]));

    const result = await serviceWith(graph).measurePeriod({
      resolved: instagram(),
      since: '2026-09-18',
      until: '2026-09-24',
    });

    expect(result).toMatchObject({
      truncated: false,
      measuredSince: '2026-09-18',
      measuredUntil: '2026-09-24',
    });
  });

  it('reads a Page as a daily series, and reports no reach for it', async () => {
    // A Page answers `page_media_view` as a plain daily series — it has no
    // `metric_type=total_value` collapsing shape and refuses every breakdown
    // Instagram accepts. Summing across days is sound *here* because this is a
    // view count, not an audience: nobody is double counted.
    const graph = jest.fn().mockResolvedValue({
      data: [
        {
          name: 'page_media_view',
          period: 'day',
          values: [
            { value: 2, end_time: '2026-09-19T07:00:00+0000' },
            { value: 0, end_time: '2026-09-20T07:00:00+0000' },
            { value: 5, end_time: '2026-09-21T07:00:00+0000' },
          ],
        },
      ],
      apiCalls: 1,
    });
    const page = {
      credential: {
        assetType: 'facebook_page',
        externalAssetId: 'page-1',
        accessToken: 'token',
      },
    } as unknown as ResolvedOrganicAnalyticsCredential;

    const result = await serviceWith(graph).measurePeriod({
      resolved: page,
      since: '2026-09-18',
      until: '2026-09-24',
    });

    expect(result).toMatchObject({ pageViews: '7', apiCalls: 1 });
    // Meta retired every Page unique-audience metric, so there is no reach to
    // report and none is invented from the views above.
    expect(result.reach).toBeNull();
    expect(result.reachOrganic).toBeNull();
    // Instagram's own `views` stays null too: it is a different measurement,
    // and putting the Page count there would invite a consolidated report to
    // add two numbers Meta never meant to be added.
    expect(result.views).toBeNull();
  });

  it('reports a Page metric Meta did not answer as null, not zero', async () => {
    const graph = jest.fn().mockResolvedValue({ data: [], apiCalls: 1 });
    const page = {
      credential: {
        assetType: 'facebook_page',
        externalAssetId: 'page-1',
        accessToken: 'token',
      },
    } as unknown as ResolvedOrganicAnalyticsCredential;

    const result = await serviceWith(graph).measurePeriod({
      resolved: page,
      since: '2026-09-18',
      until: '2026-09-24',
    });

    // A Page that published nothing and a metric Meta stopped answering look
    // the same in a total and are not the same fact.
    expect(result.pageViews).toBeNull();
  });

  it('keeps the older reach-only reading working', async () => {
    // `measure` is what the sync worker still calls. It goes through the same
    // request now, so this pins that the narrower contract did not change.
    const graph = jest.fn().mockResolvedValue(
      answer(6783, [
        ['AD', 6645],
        ['POST', 138],
      ]),
    );

    const result = await serviceWith(graph).measure({
      resolved: instagram(),
      since: '2026-08-26',
      until: '2026-09-24',
    });

    expect(result.reach).toBe('6783');
  });

  it('reads a total that arrives with no breakdown at all', async () => {
    // The shape the service asked for before the breakdown was added. Still
    // valid, and still a total rather than a null.
    const graph = jest.fn().mockResolvedValue({
      apiCalls: 1,
      data: [{ total_value: { value: 4242 } }],
    });

    const result = await serviceWith(graph).measurePeriod({
      resolved: instagram(),
      since: '2026-09-18',
      until: '2026-09-24',
    });

    expect(result.views).toBe('4242');
    // No breakdown means no slices — null, not zero. "Meta did not split this"
    // and "nothing was organic" are different statements.
    expect(result.viewsOrganic).toBeNull();
    expect(result.viewsPaid).toBeNull();
  });

  it('refuses a total_value that carries only breakdowns', async () => {
    // `follows_and_unfollows` answers this way. Reading it as zero would put a
    // confident 0 on a card for a metric that was never measured.
    const graph = jest.fn().mockResolvedValue({
      apiCalls: 1,
      data: [
        {
          total_value: {
            breakdowns: [
              {
                dimension_keys: ['media_product_type'],
                results: [{ dimension_values: ['POST'], value: 5 }],
              },
            ],
          },
        },
      ],
    });

    const result = await serviceWith(graph).measurePeriod({
      resolved: instagram(),
      since: '2026-09-18',
      until: '2026-09-24',
    });

    expect(result.views).toBeNull();
    // The slice is still readable, because that part of the payload is intact.
    expect(result.viewsOrganic).toBe('5');
  });

  it('reads the feed slice as a subset of organic, not a third bucket', async () => {
    // "Alcance das postagens" counts feed posts only. Meta spells that surface
    // three ways on this edge, so all three must land in the slice — and reels
    // and stories must stay out of it while remaining organic.
    const graph = jest.fn().mockResolvedValue(
      answer(500, [
        ['POST', 30],
        ['CAROUSEL_CONTAINER', 12],
        ['FEED', 8],
        ['REEL', 100],
        ['STORY', 50],
        ['AD', 400],
      ]),
    );

    const result = await serviceWith(graph).measurePeriod({
      resolved: instagram(),
      since: '2026-09-18',
      until: '2026-09-24',
    });

    expect(result.reachFeed).toBe('50');
    // Still counted as organic too: the feed figure narrows that slice, it
    // does not sit beside it. Reels and stories are organic as well.
    expect(result.reachOrganic).toBe('200');
  });

  it('counts an unrecognised surface as organic, never as paid', async () => {
    // A surface Meta adds later is content the account published. Dropping it
    // would understate the organic slice; calling it paid would be worse.
    const graph = jest.fn().mockResolvedValue(
      answer(30, [
        ['POST', 10],
        ['LIVE_SOMETHING', 20],
      ]),
    );

    const result = await serviceWith(graph).measurePeriod({
      resolved: instagram(),
      since: '2026-09-18',
      until: '2026-09-24',
    });

    expect(result.viewsOrganic).toBe('30');
    expect(result.viewsPaid).toBeNull();
  });
});
