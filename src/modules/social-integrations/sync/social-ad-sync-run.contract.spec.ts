import {
  SYNC_SEGMENTS_BY_KIND,
  buildSyncIdempotencyKey,
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
      ]);
    }
  });

  it('gives a hierarchy run nothing that needs a window', () => {
    expect(SYNC_SEGMENTS_BY_KIND.entities).toEqual(['hierarchy']);
  });
});
