import {
  MetaOrganicAudienceNormalizationError,
  normalizeFacebookFanDemographics,
  normalizeInstagramFollowerDemographics,
  type AudienceNormalizeContext,
} from './meta-organic-audience.normalizer';

const OBSERVED_AT = new Date('2026-09-20T12:00:00.000Z');

function context(
  overrides: Partial<AudienceNormalizeContext> = {},
): AudienceNormalizeContext {
  return {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: null,
    assetId: 'asset-a',
    provider: 'meta',
    metricDate: '2026-09-20',
    assetTimezone: 'America/Sao_Paulo',
    observedAt: OBSERVED_AT,
    syncedAt: OBSERVED_AT,
    syncRunId: 'run-a',
    ...overrides,
  };
}

/** The `total_value.breakdowns` shape Instagram answers with. */
function instagramInsights(
  results: Array<{ dimension_values: unknown[]; value: unknown }>,
) {
  return {
    data: [
      {
        name: 'follower_demographics',
        total_value: {
          breakdowns: [{ dimension_keys: ['gender'], results }],
        },
      },
    ],
  };
}

/** The lifetime `values[].value` bucket-map shape a Page answers with. */
function facebookInsights(name: string, value: unknown) {
  return {
    data: [
      {
        name,
        values: [
          { value: { stale: 1 } },
          // The newest entry is the one that counts: Meta returns the array
          // oldest-first, and taking the first would file a stale snapshot
          // under today's date.
          { value },
        ],
      },
    ],
  };
}

describe('normalizeInstagramFollowerDemographics', () => {
  it('reads one row per bucket of the requested dimension', () => {
    const rows = normalizeInstagramFollowerDemographics({
      ...context(),
      kind: 'gender',
      insights: instagramInsights([
        { dimension_values: ['F'], value: 1200 },
        { dimension_values: ['M'], value: 900 },
      ]),
    });

    expect(rows.map((row) => [row.breakdownKey, row.value])).toEqual([
      ['f', '1200'],
      ['m', '900'],
    ]);
  });

  it('files every row under the day of observation', () => {
    const rows = normalizeInstagramFollowerDemographics({
      ...context(),
      kind: 'gender',
      insights: instagramInsights([{ dimension_values: ['F'], value: 5 }]),
    });

    // A lifetime total has no period of its own, so the only honest date is the
    // day Lyra saw it.
    expect(rows[0]).toMatchObject({
      metricDate: '2026-09-20',
      observedAt: OBSERVED_AT,
      breakdownKind: 'gender',
      assetId: 'asset-a',
    });
  });

  it('returns no rows when the metric is absent, rather than zeros', () => {
    // Meta withholds this metric entirely below 100 followers. An account that
    // has not reached it must not be stored as an audience of zero people.
    expect(
      normalizeInstagramFollowerDemographics({
        ...context(),
        kind: 'gender',
        insights: { data: [] },
      }),
    ).toEqual([]);
  });

  it('drops a bucket whose key is not a string rather than mislabelling it', () => {
    const rows = normalizeInstagramFollowerDemographics({
      ...context(),
      kind: 'gender',
      insights: instagramInsights([
        { dimension_values: [null], value: 10 },
        { dimension_values: ['F'], value: 20 },
      ]),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].breakdownKey).toBe('f');
  });

  it('keeps a city key with its spaces and comma', () => {
    const rows = normalizeInstagramFollowerDemographics({
      ...context(),
      kind: 'city',
      insights: instagramInsights([
        { dimension_values: ['São Paulo, Brazil'], value: 400 },
      ]),
    });

    expect(rows[0].breakdownKey).toBe('são paulo, brazil');
  });

  it('refuses a payload that is not an insights response', () => {
    expect(() =>
      normalizeInstagramFollowerDemographics({
        ...context(),
        kind: 'gender',
        insights: { data: 'nope' },
      }),
    ).toThrow(MetaOrganicAudienceNormalizationError);
  });
});

describe('normalizeFacebookFanDemographics', () => {
  it('rewrites the gender-first key into the canonical age-first one', () => {
    const rows = normalizeFacebookFanDemographics({
      ...context(),
      kind: 'age_gender',
      metricName: 'page_fans_gender_age',
      insights: facebookInsights('page_fans_gender_age', {
        'M.25-34': 1200,
        'F.25-34': 1500,
      }),
    });

    // Canonicalized on Instagram's order so a Page and an IG account for the
    // same brand produce one set of keys rather than two disjoint ones.
    expect(rows.map((row) => row.breakdownKey).sort()).toEqual([
      '25-34|female',
      '25-34|male',
    ]);
  });

  it('keeps the unknown gender, which carries real followers', () => {
    const rows = normalizeFacebookFanDemographics({
      ...context(),
      kind: 'age_gender',
      metricName: 'page_fans_gender_age',
      insights: facebookInsights('page_fans_gender_age', { 'U.35-44': 40 }),
    });

    expect(rows[0].breakdownKey).toBe('35-44|unknown');
  });

  it('reads the newest values entry rather than the first', () => {
    const rows = normalizeFacebookFanDemographics({
      ...context(),
      kind: 'city',
      metricName: 'page_fans_city',
      insights: facebookInsights('page_fans_city', { 'São Paulo, Brazil': 77 }),
    });

    expect(rows).toEqual([
      expect.objectContaining({
        breakdownKey: 'são paulo, brazil',
        value: '77',
      }),
    ]);
  });

  it('returns no rows when the metric is absent', () => {
    expect(
      normalizeFacebookFanDemographics({
        ...context(),
        kind: 'city',
        metricName: 'page_fans_city',
        insights: { data: [] },
      }),
    ).toEqual([]);
  });

  it('drops a negative value rather than storing it', () => {
    // A negative follower count is a parsing failure, not a fact — and the
    // column's CHECK would refuse it anyway.
    const rows = normalizeFacebookFanDemographics({
      ...context(),
      kind: 'city',
      metricName: 'page_fans_city',
      insights: facebookInsights('page_fans_city', { lisbon: -3 }),
    });

    expect(rows).toEqual([]);
  });

  it('accepts a fractional value, which some breakdowns report', () => {
    const rows = normalizeFacebookFanDemographics({
      ...context(),
      kind: 'city',
      metricName: 'page_fans_city',
      insights: facebookInsights('page_fans_city', { porto: '12.5' }),
    });

    expect(rows[0].value).toBe('12.5');
  });
});
