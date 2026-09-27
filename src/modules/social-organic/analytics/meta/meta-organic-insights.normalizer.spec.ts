import {
  normalizeFacebookAccountInsights,
  normalizeFacebookPostLifetimeSnapshot,
  normalizeInstagramAccountInsights,
  normalizeInstagramMediaLifetimeSnapshot,
  readPageSeriesByDate,
} from './meta-organic-insights.normalizer';

const base = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  agencyClientId: null,
  assetId: 'asset-1',
  provider: 'meta',
  assetTimezone: 'America/Sao_Paulo',
  metricDate: '2026-09-08',
  currentDay: '2026-09-08',
  syncedAt: new Date('2026-09-08T15:00:00.000Z'),
  syncRunId: 'run-1',
};

const postLifetimeBase = {
  ...base,
  externalPublicationId: 'post-1',
  publicationId: 'publication-1',
  observedAt: new Date('2026-09-08T15:00:00.000Z'),
};

function lifetimeMetric(name: string, value: unknown) {
  return { name, period: 'lifetime', values: [{ value }] };
}

function metric(name: string, value: unknown) {
  return { name, period: 'day', values: [{ value }] };
}

function breakdownMetric(
  name: string,
  key: string,
  values: Array<[string, string | number]>,
  /**
   * Meta's own de-duplicated total, which it sends beside the breakdown.
   *
   * Optional because a payload can legitimately arrive without it, and the two
   * reads have to stay independent: omitting it must leave `viewsTotal` null
   * rather than fall back to the sum of the slices.
   */
  total?: string | number,
) {
  return {
    name,
    period: 'day',
    total_value: {
      ...(total === undefined ? {} : { value: total }),
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

describe('Meta organic account insights normalizers', () => {
  it('normalizes documented Facebook values and preserves bigint stock', () => {
    const row = normalizeFacebookAccountInsights({
      ...base,
      followersCount: '9007199254740993',
      insights: {
        data: [metric('page_media_view', { organic: '41', paid: '9' })],
      },
    });

    expect(row).toMatchObject({
      followersCount: '9007199254740993',
      impressions: '41',
      reach: null,
      assetTimezone: 'America/Sao_Paulo',
      isPartial: true,
    });
    expect(row?.providerMetrics).toHaveProperty('page_media_view');
    expect(row?.providerMetrics).toHaveProperty(
      'followers_count',
      '9007199254740993',
    );
  });

  it('preserves explicit Facebook zero and never turns missing into zero', () => {
    expect(
      normalizeFacebookAccountInsights({
        ...base,
        followersCount: undefined,
        insights: {
          data: [metric('page_media_view', { organic: 0, paid: 12 })],
        },
      })?.impressions,
    ).toBe('0');
    expect(
      normalizeFacebookAccountInsights({
        ...base,
        followersCount: undefined,
        insights: { data: [] },
      }),
    ).toBeNull();
  });

  it('normalizes only documented non-ad Instagram product breakdowns', () => {
    const row = normalizeInstagramAccountInsights({
      ...base,
      followersCount: 800,
      mediaInsights: {
        data: [
          breakdownMetric('views', 'media_product_type', [
            ['POST', 10],
            ['CAROUSEL_CONTAINER', 5],
            ['REEL', '20'],
            ['STORY', 3],
            ['AD', 999],
            ['UNKNOWN', 700],
          ]),
          breakdownMetric('reach', 'media_product_type', [
            ['STORY', 7],
            ['AD', 500],
          ]),
        ],
      },
      followInsights: {
        data: [
          breakdownMetric('follows_and_unfollows', 'follow_type', [
            ['FOLLOWER', '3'],
            ['NON_FOLLOWER', 2],
            ['UNKNOWN', 8],
          ]),
        ],
      },
    });

    expect(row).toMatchObject({
      followersCount: '800',
      followersGained: '3',
      followersLost: '2',
      impressions: '38',
      reach: '7',
      profileViews: null,
      // This payload carries no `total_value.value`, so the total is unknown —
      // not the sum of the slices, which would silently invent a figure that
      // excludes the ads Meta counts in its own total.
      viewsTotal: null,
      reachTotal: null,
    });
  });

  it('reads the ads-inclusive total and the organic slice from one payload', () => {
    // The two answers live in the same response: `total_value.value` is the
    // account total, the breakdown beneath it is the split. Reading both is
    // what lets a card show the number Meta's app shows and still break it
    // into organic and paid.
    const row = normalizeInstagramAccountInsights({
      ...base,
      followersCount: 800,
      mediaInsights: {
        data: [
          breakdownMetric(
            'views',
            'media_product_type',
            [
              ['POST', 123],
              ['STORY', 347],
              ['REEL', 20],
              ['CAROUSEL_CONTAINER', 19],
              ['AD', 8646],
            ],
            9155,
          ),
          breakdownMetric(
            'reach',
            'media_product_type',
            [
              ['POST', 39],
              ['STORY', 105],
              ['REEL', 11],
              ['CAROUSEL_CONTAINER', 1],
              ['AD', 6645],
            ],
            6783,
          ),
        ],
      },
      followInsights: { data: [] },
    });

    expect(row).toMatchObject({
      // Organic only: the four non-AD surfaces.
      impressions: '509',
      reach: '156',
      // Meta's own total, ads included.
      viewsTotal: '9155',
      reachTotal: '6783',
    });

    // The reach total is deliberately NOT organic + AD (156 + 6645 = 6801).
    // Meta de-duplicates across the two, so anyone reached both ways is counted
    // once — which is exactly why the total must be read and never computed.
    expect(row?.reachTotal).toBe('6783');
  });

  it('keeps missing Instagram values null and preserves explicit zero', () => {
    const row = normalizeInstagramAccountInsights({
      ...base,
      followersCount: undefined,
      mediaInsights: {
        data: [breakdownMetric('views', 'media_product_type', [['POST', 0]])],
      },
      followInsights: { data: [] },
    });

    expect(row?.impressions).toBe('0');
    expect(row?.reach).toBeNull();
    expect(row?.followersCount).toBeNull();
    expect(row?.followersGained).toBeNull();
  });

  it.each([
    null,
    {},
    { data: [{}] },
    {
      data: [breakdownMetric('views', 'media_product_type', [['POST', -1]])],
    },
  ])('fails closed for malformed provider payload %#', (mediaInsights) => {
    expect(() =>
      normalizeInstagramAccountInsights({
        ...base,
        followersCount: undefined,
        mediaInsights,
        followInsights: { data: [] },
      }),
    ).toThrow('meta_invalid_response');
  });

  // Observed in production on 2026-09-21: Meta answers a quiet day with the
  // breakdown envelope and no `results` key at all. Before this was handled the
  // whole run failed as `meta_invalid_response`, so a single day with no
  // follows or unfollows stopped that day's account metrics from being written.
  it('reads a breakdown with no results as an absence, not a malformed payload', () => {
    const row = normalizeInstagramAccountInsights({
      ...base,
      followersCount: 1061,
      mediaInsights: {
        data: [breakdownMetric('views', 'media_product_type', [['POST', 4]])],
      },
      followInsights: {
        data: [
          {
            name: 'follows_and_unfollows',
            period: 'day',
            total_value: { breakdowns: [{ dimension_keys: ['follow_type'] }] },
          },
        ],
      },
    });

    expect(row).toMatchObject({
      followersCount: '1061',
      impressions: '4',
      followersGained: null,
      followersLost: null,
    });
  });

  it('still fails closed when results is present but not an array', () => {
    expect(() =>
      normalizeInstagramAccountInsights({
        ...base,
        followersCount: undefined,
        mediaInsights: {
          data: [
            {
              name: 'views',
              period: 'day',
              total_value: {
                breakdowns: [
                  { dimension_keys: ['media_product_type'], results: 'nope' },
                ],
              },
            },
          ],
        },
        followInsights: { data: [] },
      }),
    ).toThrow('meta_invalid_response');
  });

  it('reads profile views from the engagement family', () => {
    const row = normalizeInstagramAccountInsights({
      ...base,
      followersCount: undefined,
      mediaInsights: {
        data: [breakdownMetric('views', 'media_product_type', [['POST', 9]])],
      },
      followInsights: { data: [] },
      engagementInsights: {
        data: [
          { name: 'profile_views', period: 'day', total_value: { value: 12 } },
        ],
      },
    });

    expect(row?.profileViews).toBe('12');
  });

  /**
   * The whole engagement family, not just `profile_views`.
   *
   * All seven were already being requested in one call and all seven were
   * already being stored in `provider_metrics`; migration 1795600000000 gave
   * six of them columns. This pins that the normalizer now writes them, which
   * is the difference between "collected" and "visible".
   */
  it('reads the whole engagement family, not only profile views', () => {
    const row = normalizeInstagramAccountInsights({
      ...base,
      followersCount: undefined,
      mediaInsights: {
        data: [breakdownMetric('views', 'media_product_type', [['POST', 9]])],
      },
      followInsights: { data: [] },
      engagementInsights: {
        data: [
          { name: 'profile_views', period: 'day', total_value: { value: 12 } },
          {
            name: 'total_interactions',
            period: 'day',
            total_value: { value: 31 },
          },
          {
            name: 'accounts_engaged',
            period: 'day',
            total_value: { value: 24 },
          },
          { name: 'likes', period: 'day', total_value: { value: 18 } },
          { name: 'comments', period: 'day', total_value: { value: 5 } },
          { name: 'shares', period: 'day', total_value: { value: 4 } },
          { name: 'saves', period: 'day', total_value: { value: 3 } },
          { name: 'replies', period: 'day', total_value: { value: 1 } },
        ],
      },
    });

    expect(row).toMatchObject({
      profileViews: '12',
      totalInteractions: '31',
      accountsEngaged: '24',
      likes: '18',
      comments: '5',
      shares: '4',
      saves: '3',
      replies: '1',
    });
  });

  it('keeps an explicit zero from the engagement family', () => {
    // A day with no profile visits is a measurement, not an absence — the
    // distinction the whole normalizer is built around.
    const row = normalizeInstagramAccountInsights({
      ...base,
      followersCount: undefined,
      mediaInsights: {
        data: [breakdownMetric('views', 'media_product_type', [['POST', 1]])],
      },
      followInsights: { data: [] },
      engagementInsights: {
        data: [
          { name: 'profile_views', period: 'day', total_value: { value: 0 } },
        ],
      },
    });

    expect(row?.profileViews).toBe('0');
  });

  it('normalizes without the engagement read at all', () => {
    // A caller that predates the engagement request, or a replayed payload
    // stored before it existed, still yields a row.
    const row = normalizeInstagramAccountInsights({
      ...base,
      followersCount: undefined,
      mediaInsights: {
        data: [breakdownMetric('views', 'media_product_type', [['POST', 3]])],
      },
      followInsights: { data: [] },
    });

    expect(row).toMatchObject({ impressions: '3', profileViews: null });
  });

  it('marks only the asset-local same day partial', () => {
    const row = normalizeInstagramAccountInsights({
      ...base,
      metricDate: '2026-09-07',
      followersCount: undefined,
      mediaInsights: {
        data: [breakdownMetric('views', 'media_product_type', [['POST', 1]])],
      },
      followInsights: { data: [] },
    });

    expect(row?.isPartial).toBe(false);
    expect(row?.assetTimezone).toBe('America/Sao_Paulo');
  });
});

describe('Meta organic post lifetime snapshot normalizers', () => {
  describe('normalizeFacebookPostLifetimeSnapshot', () => {
    it('normalizes a full response into the impressionsLifetime snapshot', () => {
      const row = normalizeFacebookPostLifetimeSnapshot({
        ...postLifetimeBase,
        insights: { data: [lifetimeMetric('post_media_view', 42)] },
      });

      expect(row).toMatchObject({
        externalPublicationId: 'post-1',
        publicationId: 'publication-1',
        metricDate: '2026-09-08',
        impressionsLifetime: '42',
        impressionsLifetimeObservedAt: postLifetimeBase.observedAt,
        // Every flow field stays null; a lifetime snapshot never populates
        // the daily-flow columns.
        impressions: null,
        likes: null,
        comments: null,
        // Never populated by the FB normalizer.
        likesLifetime: null,
        commentsLifetime: null,
        videoViewsLifetime: null,
        isPartial: false,
      });
      expect(row?.providerMetrics).toHaveProperty('post_media_view');
    });

    it('returns null when post_media_view is absent from the response', () => {
      expect(
        normalizeFacebookPostLifetimeSnapshot({
          ...postLifetimeBase,
          insights: { data: [] },
        }),
      ).toBeNull();
    });

    it('fails closed for a malformed response shape', () => {
      expect(() =>
        normalizeFacebookPostLifetimeSnapshot({
          ...postLifetimeBase,
          insights: { data: [{}] },
        }),
      ).toThrow('meta_invalid_response');
    });
  });

  describe('normalizeInstagramMediaLifetimeSnapshot', () => {
    it('normalizes a full response into all three lifetime fields', () => {
      const row = normalizeInstagramMediaLifetimeSnapshot({
        ...postLifetimeBase,
        insights: {
          data: [
            lifetimeMetric('comments', 3),
            lifetimeMetric('likes', 9),
            lifetimeMetric('views', 100),
          ],
        },
      });

      expect(row).toMatchObject({
        commentsLifetime: '3',
        commentsLifetimeObservedAt: postLifetimeBase.observedAt,
        likesLifetime: '9',
        likesLifetimeObservedAt: postLifetimeBase.observedAt,
        videoViewsLifetime: '100',
        videoViewsLifetimeObservedAt: postLifetimeBase.observedAt,
        impressionsLifetime: null,
        isPartial: false,
      });
    });

    it('returns a row with only the present subset for a partial IG response', () => {
      const row = normalizeInstagramMediaLifetimeSnapshot({
        ...postLifetimeBase,
        insights: { data: [lifetimeMetric('likes', 5)] },
      });

      expect(row).toMatchObject({
        likesLifetime: '5',
        likesLifetimeObservedAt: postLifetimeBase.observedAt,
        commentsLifetime: null,
        commentsLifetimeObservedAt: null,
        videoViewsLifetime: null,
        videoViewsLifetimeObservedAt: null,
      });
    });

    it('returns null only when all three metrics are absent', () => {
      expect(
        normalizeInstagramMediaLifetimeSnapshot({
          ...postLifetimeBase,
          insights: { data: [] },
        }),
      ).toBeNull();
    });

    it('fails closed for a malformed response shape', () => {
      expect(() =>
        normalizeInstagramMediaLifetimeSnapshot({
          ...postLifetimeBase,
          insights: null,
        }),
      ).toThrow('meta_invalid_response');
    });
  });
});

describe('readPageSeriesByDate', () => {
  /** Meta stamps each entry with midnight at the START of the next day. */
  const series = (name: string, values: Array<[string, number]>) => ({
    name,
    period: 'day',
    values: values.map(([end_time, value]) => ({ end_time, value })),
  });

  it('files each entry under the day it describes, not its end_time', () => {
    // 07:00Z is midnight in São Paulo. The entry stamped with the 28th covers
    // the 27th, and filing it under the 28th would shift the whole series
    // forward a day while still drawing a plausible chart.
    const byDate = readPageSeriesByDate(
      {
        data: [
          series('page_follows', [
            ['2026-08-28T07:00:00+0000', 148],
            ['2026-08-29T07:00:00+0000', 149],
          ]),
        ],
      },
      'America/Sao_Paulo',
    );

    expect([...byDate.keys()].sort()).toEqual(['2026-08-27', '2026-08-28']);
    expect(byDate.get('2026-08-27')?.pageFollows).toBe('148');
    expect(byDate.get('2026-08-28')?.pageFollows).toBe('149');
  });

  it('reads the day in the asset timezone, not UTC', () => {
    // The same instant falls on two different dates: 02:00Z on the 28th is
    // still 23:00 on the 27th in São Paulo (UTC-3). A Page filed in UTC would
    // be off by one for every reading after 21:00 local.
    const payload = {
      data: [series('page_follows', [['2026-08-28T02:00:00+0000', 148]])],
    };

    expect([
      ...readPageSeriesByDate(payload, 'America/Sao_Paulo').keys(),
    ]).toEqual(['2026-08-26']);
    expect([...readPageSeriesByDate(payload, 'UTC').keys()]).toEqual([
      '2026-08-27',
    ]);
  });

  it('merges every metric onto the day they share', () => {
    const byDate = readPageSeriesByDate(
      {
        data: [
          series('page_follows', [['2026-09-13T07:00:00+0000', 150]]),
          series('page_daily_follows_unique', [
            ['2026-09-13T07:00:00+0000', 1],
          ]),
          series('page_daily_unfollows_unique', [
            ['2026-09-13T07:00:00+0000', 0],
          ]),
          series('page_messages_new_conversations_unique', [
            ['2026-09-13T07:00:00+0000', 2],
          ]),
        ],
      },
      'America/Sao_Paulo',
    );

    expect(byDate.get('2026-09-12')).toEqual({
      pageFollows: '150',
      pageDailyFollows: '1',
      pageDailyUnfollows: '0',
      newConversations: '2',
    });
  });

  it('leaves a metric null rather than zero when it is absent', () => {
    // A Page whose token lacks the messaging scope answers with the other
    // three. Storing zero conversations would be a measurement nobody made.
    const byDate = readPageSeriesByDate(
      { data: [series('page_follows', [['2026-09-13T07:00:00+0000', 150]])] },
      'America/Sao_Paulo',
    );

    expect(byDate.get('2026-09-12')).toEqual({
      pageFollows: '150',
      pageDailyFollows: null,
      pageDailyUnfollows: null,
      newConversations: null,
    });
  });

  it('keeps a measured zero, which is not the same as absent', () => {
    const byDate = readPageSeriesByDate(
      {
        data: [
          series('page_daily_follows_unique', [
            ['2026-09-13T07:00:00+0000', 0],
          ]),
        ],
      },
      'America/Sao_Paulo',
    );

    expect(byDate.get('2026-09-12')?.pageDailyFollows).toBe('0');
  });

  it('is empty for a payload with no data rather than throwing', () => {
    expect(readPageSeriesByDate({ data: [] }, 'UTC').size).toBe(0);
  });
});
