import {
  normalizeFacebookAccountInsights,
  normalizeFacebookPostLifetimeSnapshot,
  normalizeInstagramAccountInsights,
  normalizeInstagramMediaLifetimeSnapshot,
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
    });
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
