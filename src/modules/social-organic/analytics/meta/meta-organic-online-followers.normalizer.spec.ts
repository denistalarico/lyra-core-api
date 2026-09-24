import {
  MetaOrganicOnlineFollowersNormalizationError,
  normalizeInstagramOnlineFollowers,
} from './meta-organic-online-followers.normalizer';

const OBSERVED_AT = new Date('2026-09-24T12:00:00.000Z');

function context(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: null,
    assetId: 'asset-a',
    provider: 'meta',
    assetTimezone: 'America/Sao_Paulo',
    observedAt: OBSERVED_AT,
    syncedAt: OBSERVED_AT,
    syncRunId: 'run-a',
    ...overrides,
  };
}

/** The `values[]` shape Meta answers `online_followers` with. */
function insights(days: Array<{ end_time: string; value: unknown }>) {
  return { data: [{ name: 'online_followers', values: days }] };
}

describe('normalizeInstagramOnlineFollowers', () => {
  it('reads one row per hour and keeps Meta’s own Pacific indexing', () => {
    const rows = normalizeInstagramOnlineFollowers({
      ...context(),
      insights: insights([
        {
          // Midnight Pacific during daylight saving is 07:00Z, which is the
          // stamp production returned on 2026-09-24.
          end_time: '2026-09-17T07:00:00+0000',
          value: { '0': 37, '13': 232, '23': 24 },
        },
      ]),
    } as never);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => [row.hourOfDay, row.followersOnline])).toEqual([
      [0, '37'],
      [13, '232'],
      [23, '24'],
    ]);
    // The day is the Pacific calendar day, and the row says so rather than
    // leaving a reader to assume the asset's zone.
    expect(rows[0]).toMatchObject({
      metricDate: '2026-09-17',
      sourceTimezone: 'America/Los_Angeles',
      assetTimezone: 'America/Sao_Paulo',
    });
  });

  it('reads the Pacific day under both standard and daylight offsets', () => {
    // 07:00Z is midnight PDT in September; in January the same midnight is
    // 08:00Z. Reading the calendar date *in* Pacific gets both right, where
    // subtracting a fixed seven hours would file January's readings a day early.
    const rows = normalizeInstagramOnlineFollowers({
      ...context(),
      insights: insights([
        { end_time: '2026-09-17T07:00:00+0000', value: { '0': 1 } },
        { end_time: '2027-01-15T08:00:00+0000', value: { '0': 2 } },
      ]),
    } as never);

    expect(rows.map((row) => row.metricDate)).toEqual([
      '2026-09-17',
      '2027-01-15',
    ]);
  });

  it('skips a day Meta has no data for instead of writing 24 zeros', () => {
    // `value: {}` is routine — the most recent day is usually empty. Zeroing it
    // would draw a confident trough at whatever hour the account is busiest.
    const rows = normalizeInstagramOnlineFollowers({
      ...context(),
      insights: insights([
        { end_time: '2026-09-23T07:00:00+0000', value: {} },
        { end_time: '2026-09-22T07:00:00+0000', value: { '9': 100 } },
      ]),
    } as never);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ metricDate: '2026-09-22', hourOfDay: 9 });
  });

  it('keeps a real zero, which is a measurement', () => {
    // Different from the empty day above: Meta said nobody was online at 04:00.
    const rows = normalizeInstagramOnlineFollowers({
      ...context(),
      insights: insights([
        { end_time: '2026-09-22T07:00:00+0000', value: { '4': 0 } },
      ]),
    } as never);

    expect(rows).toHaveLength(1);
    expect(rows[0].followersOnline).toBe('0');
  });

  it('drops an hour outside 0-23 rather than storing it', () => {
    const rows = normalizeInstagramOnlineFollowers({
      ...context(),
      insights: insights([
        {
          end_time: '2026-09-22T07:00:00+0000',
          value: { '9': 10, '24': 5, nonsense: 7, '-1': 3 },
        },
      ]),
    } as never);

    expect(rows.map((row) => row.hourOfDay)).toEqual([9]);
  });

  it('returns nothing when the metric is absent, rather than failing', () => {
    // An account Meta withholds this metric for is not a broken response.
    expect(
      normalizeInstagramOnlineFollowers({
        ...context(),
        insights: { data: [] },
      } as never),
    ).toEqual([]);
  });

  it('refuses a payload whose shape it does not understand', () => {
    // A `values` that is not an array, or a day with no usable `end_time`,
    // means readings would be filed under a guessed day. Better to fail.
    for (const broken of [
      { data: [{ name: 'online_followers', values: 'nope' }] },
      insights([{ end_time: 'not-a-date', value: { '0': 1 } }]),
      insights([{ end_time: undefined as never, value: { '0': 1 } }]),
    ]) {
      expect(() =>
        normalizeInstagramOnlineFollowers({
          ...context(),
          insights: broken,
        } as never),
      ).toThrow(MetaOrganicOnlineFollowersNormalizationError);
    }
  });
});
