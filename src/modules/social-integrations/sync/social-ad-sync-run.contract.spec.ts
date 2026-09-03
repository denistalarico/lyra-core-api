import {
  INSIGHTS_LEVEL_BY_SEGMENT,
  SYNC_SEGMENTS_BY_KIND,
  buildSyncIdempotencyKey,
  coversInsightsLevels,
  isInsightsSegment,
} from './social-ad-sync-run.contract';

const BASE = {
  connectionId: '11111111-1111-4111-8111-111111111111',
  runKind: 'manual' as const,
  windowStart: '2026-08-01',
  windowEnd: '2026-08-25',
  entityLevels: ['account', 'campaign', 'adset', 'ad'] as const,
};

describe('buildSyncIdempotencyKey', () => {
  it('produces the same key for the same intent', () => {
    expect(buildSyncIdempotencyKey(BASE)).toBe(
      buildSyncIdempotencyKey({ ...BASE }),
    );
  });

  it('ignores the order the levels were listed in', () => {
    // Two callers describing one read must not become two runs racing over the
    // same days.
    expect(
      buildSyncIdempotencyKey({
        ...BASE,
        entityLevels: ['ad', 'adset', 'campaign', 'account'],
      }),
    ).toBe(buildSyncIdempotencyKey(BASE));
  });

  it('separates every field that changes what the run would do', () => {
    const base = buildSyncIdempotencyKey(BASE);

    expect(
      buildSyncIdempotencyKey({ ...BASE, windowStart: '2026-07-01' }),
    ).not.toBe(base);
    expect(
      buildSyncIdempotencyKey({ ...BASE, windowEnd: '2026-08-24' }),
    ).not.toBe(base);
    expect(buildSyncIdempotencyKey({ ...BASE, runKind: 'daily' })).not.toBe(
      base,
    );
    expect(
      buildSyncIdempotencyKey({ ...BASE, entityLevels: ['account'] }),
    ).not.toBe(base);
    expect(
      buildSyncIdempotencyKey({
        ...BASE,
        connectionId: '22222222-2222-4222-8222-222222222222',
      }),
    ).not.toBe(base);
  });

  it('carries no clock, so two calls a second apart still collide', () => {
    // The whole point: a key with a timestamp in it deduplicates nothing, and
    // "sync now" clicked twice would put two readers on the same window.
    const first = buildSyncIdempotencyKey(BASE);
    const second = buildSyncIdempotencyKey(BASE);

    expect(first).toBe(second);
    expect(first).not.toMatch(/\d{13}/);
  });

  it('keys a windowless run without pretending it has dates', () => {
    const key = buildSyncIdempotencyKey({
      ...BASE,
      runKind: 'entities',
      windowStart: null,
      windowEnd: null,
    });

    expect(key).toContain(':entities:-:-:');
  });

  it('fits the column', () => {
    // `idempotency_key` is varchar(200); a key that overflows would be an
    // insert failure at the moment somebody clicks sync.
    expect(buildSyncIdempotencyKey(BASE).length).toBeLessThanOrEqual(200);
  });
});

describe('SYNC_SEGMENTS_BY_KIND', () => {
  it('runs the hierarchy before the insights that reference it', () => {
    // Facts carry no foreign key to the mirror, so a campaign can be measured
    // before it is known — but a UI that resolves ids would render one.
    for (const kind of ['manual', 'daily'] as const) {
      expect(SYNC_SEGMENTS_BY_KIND[kind]).toEqual([
        'hierarchy',
        'account_insights',
        'campaign_insights',
        'adset_insights',
      ]);
    }
  });

  it('gives a hierarchy run nothing that needs a window', () => {
    expect(SYNC_SEGMENTS_BY_KIND.entities).toEqual(['hierarchy']);
  });

  it('reads insights coarsest first, so a failure costs the finest level', () => {
    // Ad set is the largest read and the last one. When it fails, the account
    // and campaign facts for the window have already landed — which is what
    // makes an ad-set rate limit a `partial` run rather than a lost window.
    for (const kind of ['manual', 'daily', 'backfill', 'intraday'] as const) {
      const insights = SYNC_SEGMENTS_BY_KIND[kind].filter(isInsightsSegment);

      expect(insights).toEqual([
        'account_insights',
        'campaign_insights',
        'adset_insights',
      ]);
    }
  });

  it('ingests ad set on every insights kind, intraday included', () => {
    // Destination lives on the ad set, so a kind that skipped this level would
    // make per-destination numbers blind to the period it covers. Intraday is
    // the one that would have been tempting to leave out.
    for (const kind of ['manual', 'daily', 'backfill', 'intraday'] as const) {
      expect(SYNC_SEGMENTS_BY_KIND[kind]).toContain('adset_insights');
    }
  });
});

describe('INSIGHTS_LEVEL_BY_SEGMENT', () => {
  it('maps each insights segment to the level it reads', () => {
    expect(INSIGHTS_LEVEL_BY_SEGMENT).toEqual({
      account_insights: 'account',
      campaign_insights: 'campaign',
      adset_insights: 'adset',
    });
  });

  it('covers every insights segment, so no segment falls through a default', () => {
    // The worker used to pick the level with
    // `segment === 'account_insights' ? 'account' : 'campaign'`. That silently
    // read a third segment at the wrong level; this map is total, so the
    // compiler catches the fourth.
    const insightsSegments = new Set(
      Object.values(SYNC_SEGMENTS_BY_KIND).flat().filter(isInsightsSegment),
    );

    for (const segment of insightsSegments) {
      expect(INSIGHTS_LEVEL_BY_SEGMENT[segment]).toBeDefined();
    }
  });

  it('does not treat the hierarchy as an insights segment', () => {
    expect(isInsightsSegment('hierarchy')).toBe(false);
  });
});

describe('coversInsightsLevels', () => {
  it('accepts a run that recorded every level currently ingested', () => {
    expect(coversInsightsLevels(['account', 'campaign', 'adset'])).toBe(true);
  });

  it('rejects a run written before ad set insights existed', () => {
    // The exact shape of every backfill run on the existing production
    // connection: thirteen chunks, all `succeeded`, all `["account","campaign"]`.
    // They fetched what they claimed; they simply never asked for ad set.
    expect(coversInsightsLevels(['account', 'campaign'])).toBe(false);
  });

  it('accepts a run that read more levels than are required', () => {
    // Coverage, not equality. A `daily` run records all four hierarchy levels.
    expect(coversInsightsLevels(['account', 'campaign', 'adset', 'ad'])).toBe(
      true,
    );
  });

  it('fails closed on anything that is not a list of levels', () => {
    // `entity_levels` is jsonb: it holds whatever was written to it. Treating
    // an unreadable value as full coverage would certify history nobody read.
    for (const value of [null, undefined, {}, 'account', 42, [1, 2]]) {
      expect(coversInsightsLevels(value)).toBe(false);
    }
  });

  it('honours an explicit requirement, so a narrower question can be asked', () => {
    expect(coversInsightsLevels(['account', 'campaign'], ['account'])).toBe(
      true,
    );
  });
});
