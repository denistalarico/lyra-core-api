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

  it('spends no call on a Facebook Page, which cannot answer this', async () => {
    const graph = jest.fn();
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

    expect(graph).not.toHaveBeenCalled();
    expect(result).toMatchObject({ views: null, reach: null, apiCalls: 0 });
  });

  it('keeps the older reach-only reading working', async () => {
    // `measure` is what the sync worker still calls. It goes through the same
    // request now, so this pins that the narrower contract did not change.
    const graph = jest
      .fn()
      .mockResolvedValue(answer(6783, [['AD', 6645], ['POST', 138]]));

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

  it('counts an unrecognised surface as organic, never as paid', async () => {
    // A surface Meta adds later is content the account published. Dropping it
    // would understate the organic slice; calling it paid would be worse.
    const graph = jest
      .fn()
      .mockResolvedValue(answer(30, [['POST', 10], ['LIVE_SOMETHING', 20]]));

    const result = await serviceWith(graph).measurePeriod({
      resolved: instagram(),
      since: '2026-09-18',
      until: '2026-09-24',
    });

    expect(result.viewsOrganic).toBe('30');
    expect(result.viewsPaid).toBeNull();
  });
});
