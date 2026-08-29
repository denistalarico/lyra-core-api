import {
  PAID_MEDIA_RATIOS,
  assertAggregable,
  requireIntelligenceScope,
  type IntelligenceFactQuery,
} from '../../../common/intelligence';
import { deriveSocialAdKpis, divideScaled } from '../analytics/social-ad-kpi';
import type { SocialAnalyticsReadService } from '../services/social-analytics-read.service';
import { SocialPaidMediaIntelligenceAdapter } from './social-paid-media-intelligence.adapter';
import { PAID_MEDIA_METRICS_BY_KEY } from './social-paid-media-metrics';

const SCOPE = requireIntelligenceScope({
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  agencyClientId: 'client-1',
});

const CONNECTION_ID = 'connection-1';

function query(
  overrides: Partial<IntelligenceFactQuery> = {},
): IntelligenceFactQuery {
  return {
    scope: SCOPE,
    window: { since: '2026-08-01', until: '2026-08-30' },
    grain: 'period',
    subjectId: CONNECTION_ID,
    ...overrides,
  };
}

function totals(overrides: Record<string, unknown> = {}) {
  return {
    spend: '1000.000000',
    impressions: '50000',
    clicks: '900',
    linkClicks: '700',
    leads: '40',
    conversions: '12.500000',
    conversionValue: '3500.000000',
    videoViews: '2200',
    reach: null,
    reachGranularity: 'daily' as const,
    ctr: '1.800000',
    cpc: '1.111111',
    cpm: '20.000000',
    cpl: '25.000000',
    cpa: '80.000000',
    roas: '3.500000',
    ...overrides,
  };
}

function seriesPoint(date: string, overrides: Record<string, unknown> = {}) {
  return {
    date,
    hasData: true,
    spend: '10.000000',
    impressions: '500',
    clicks: '9',
    linkClicks: '7',
    leads: '1',
    conversions: '0.500000',
    conversionValue: '35.000000',
    videoViews: '22',
    reach: '480',
    isPartial: false,
    ctr: '1.800000',
    cpc: '1.111111',
    cpm: '20.000000',
    cpl: '10.000000',
    cpa: '20.000000',
    roas: '3.500000',
    ...overrides,
  };
}

function freshness(overrides: Record<string, unknown> = {}) {
  return {
    connectionId: CONNECTION_ID,
    timezone: 'America/Sao_Paulo',
    connectionStatus: 'connected',
    lastSyncedAt: '2026-08-30T06:00:00.000Z',
    lastSyncError: null,
    metrics: {
      latestMetricDate: '2026-08-30',
      latestClosedMetricDate: '2026-08-29',
      latestPartialMetricDate: null,
      latestMetricsSyncedAt: '2026-08-30T06:00:00.000Z',
      ...((overrides.metrics as Record<string, unknown>) ?? {}),
    },
    runs: { latestSuccessfulDailyRun: null, latestSuccessfulIntradayRun: null },
    backfill: {
      status: 'complete',
      anchor: '2026-08-30',
      chunksTotal: 3,
      chunksSucceeded: 3,
      chunksInFlight: 0,
      stalled: false,
      complete: true,
    },
    hasPartialData: false,
  };
}

function buildReads(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    overview: jest.fn().mockResolvedValue({
      connectionId: CONNECTION_ID,
      timezone: 'America/Sao_Paulo',
      currency: 'BRL',
      period: { since: '2026-08-01', until: '2026-08-30' },
      comparisonPeriod: { since: '2026-07-02', until: '2026-07-31' },
      current: totals(),
      previous: totals(),
      change: {},
      hasPartialData: false,
      lastFactDate: '2026-08-30',
    }),
    timeseries: jest.fn().mockResolvedValue({
      connectionId: CONNECTION_ID,
      timezone: 'America/Sao_Paulo',
      currency: 'BRL',
      period: { since: '2026-08-01', until: '2026-08-02' },
      seriesMode: 'continuous',
      points: [seriesPoint('2026-08-01'), seriesPoint('2026-08-02')],
      observedDays: 2,
      hasPartialData: false,
    }),
    freshness: jest.fn().mockResolvedValue(freshness()),
    listConnections: jest.fn(),
    campaigns: jest.fn(),
    ...overrides,
  } as unknown as SocialAnalyticsReadService;
}

/**
 * The scope arguments one read-service method was called with.
 *
 * Typed rather than reached through `jest.Mock`, whose `mock.calls` is `any[]`
 * — so `call.agencyClientId` would be an unchecked property access, and a typo
 * in the field name would make the assertion pass against `undefined`. Which is
 * exactly the assertion that must not silently pass here: it is checking that
 * the client filter travels.
 */
function firstCall(
  reads: SocialAnalyticsReadService,
  method: 'overview' | 'timeseries' | 'freshness',
): {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  connectionId: string;
  since?: string;
  until?: string;
} {
  const calls = (reads[method] as unknown as jest.Mock).mock
    .calls as ReturnType<typeof firstCall>[][];

  return calls[0][0];
}

describe('SocialPaidMediaIntelligenceAdapter', () => {
  it('declares the paid_media domain and both grains', () => {
    const adapter = new SocialPaidMediaIntelligenceAdapter(buildReads());

    expect(adapter.domain).toBe('paid_media');
    expect(adapter.supportedGrains).toEqual(['day', 'period']);
    expect(adapter.ratios).toBe(PAID_MEDIA_RATIOS);
  });

  it('returns account-level period facts for every declared metric', async () => {
    const adapter = new SocialPaidMediaIntelligenceAdapter(buildReads());

    const set = await adapter.fetch(query());

    expect(set.grain).toBe('period');
    expect(set.subject).toEqual({ type: 'ad_account', id: CONNECTION_ID });
    expect(set.facts).toHaveLength(9);
    expect(set.facts.map((fact) => fact.metricKey).sort()).toEqual(
      [...PAID_MEDIA_METRICS_BY_KEY.keys()].sort(),
    );
    expect(set.facts.find((fact) => fact.metricKey === 'spend')?.value).toBe(
      '1000.000000',
    );
  });

  /**
   * The four filters that decide whether these numbers are right live in the
   * read service. This asserts the adapter delegates rather than re-deriving —
   * a second implementation would drift silently and produce plausible,
   * doubled totals.
   */
  it('delegates to the read service rather than querying', async () => {
    const reads = buildReads();
    const adapter = new SocialPaidMediaIntelligenceAdapter(reads);

    await adapter.fetch(query());

    expect(firstCall(reads, 'overview')).toEqual({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: 'client-1',
      connectionId: CONNECTION_ID,
      since: '2026-08-01',
      until: '2026-08-30',
    });
  });

  it('passes the full scope through, so another client cannot be reached', async () => {
    const reads = buildReads();
    const adapter = new SocialPaidMediaIntelligenceAdapter(reads);

    await adapter.fetch(query());

    for (const call of [
      firstCall(reads, 'overview'),
      firstCall(reads, 'freshness'),
    ]) {
      expect(call.tenantId).toBe('tenant-1');
      expect(call.workspaceId).toBe('workspace-1');
      expect(call.agencyClientId).toBe('client-1');
    }
  });

  it('passes a null client through as agency context, not as unfiltered', async () => {
    const reads = buildReads();
    const adapter = new SocialPaidMediaIntelligenceAdapter(reads);

    await adapter.fetch(
      query({
        scope: requireIntelligenceScope({
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
        }),
      }),
    );

    expect(firstCall(reads, 'overview').agencyClientId).toBeNull();
  });

  it('emits one fact per metric per day at day grain', async () => {
    const adapter = new SocialPaidMediaIntelligenceAdapter(buildReads());

    const set = await adapter.fetch(
      query({
        grain: 'day',
        window: { since: '2026-08-01', until: '2026-08-02' },
      }),
    );

    expect(set.facts).toHaveLength(18);
    expect(
      set.facts.filter((fact) => fact.dimensions.date === '2026-08-01'),
    ).toHaveLength(9);
  });

  /**
   * Reach at day grain is the stored, de-duplicated figure; at period grain the
   * read service already refuses it. Both behaviours must survive here, and the
   * period null must agree with the descriptor rather than contradict it.
   */
  it('reports reach at day grain and null at period grain', async () => {
    const adapter = new SocialPaidMediaIntelligenceAdapter(buildReads());

    const day = await adapter.fetch(
      query({
        grain: 'day',
        window: { since: '2026-08-01', until: '2026-08-02' },
      }),
    );
    const period = await adapter.fetch(query());

    expect(
      day.facts.find(
        (f) => f.metricKey === 'reach' && f.dimensions.date === '2026-08-01',
      )?.value,
    ).toBe('480');

    expect(period.facts.find((f) => f.metricKey === 'reach')?.value).toBeNull();
  });

  it('declares reach non-additive, so a consumer cannot sum the daily values', async () => {
    const adapter = new SocialPaidMediaIntelligenceAdapter(buildReads());

    const set = await adapter.fetch(
      query({
        grain: 'day',
        window: { since: '2026-08-01', until: '2026-08-02' },
      }),
    );

    const reach = set.descriptors.find((d) => d.key === 'reach');

    expect(reach?.additivity).toBe('non_additive');
    expect(() => assertAggregable(reach!, 2)).toThrow('non_additive');
  });

  it('distinguishes a day with no delivery from a day never synced', async () => {
    const reads = buildReads({
      timeseries: jest.fn().mockResolvedValue({
        connectionId: CONNECTION_ID,
        timezone: 'America/Sao_Paulo',
        currency: 'BRL',
        period: { since: '2026-08-01', until: '2026-08-02' },
        seriesMode: 'continuous',
        points: [
          seriesPoint('2026-08-01', { spend: '0.000000' }),
          // The read service's gap shape: never observed.
          {
            date: '2026-08-02',
            hasData: false,
            spend: null,
            impressions: null,
            clicks: null,
            linkClicks: null,
            leads: null,
            conversions: null,
            conversionValue: null,
            videoViews: null,
            reach: null,
            isPartial: false,
            ctr: null,
            cpc: null,
            cpm: null,
            cpl: null,
            cpa: null,
            roas: null,
          },
        ],
        observedDays: 1,
        hasPartialData: false,
      }),
    });
    const adapter = new SocialPaidMediaIntelligenceAdapter(reads);

    const set = await adapter.fetch(
      query({
        grain: 'day',
        window: { since: '2026-08-01', until: '2026-08-02' },
      }),
    );

    const spendOn = (date: string) =>
      set.facts.find(
        (f) => f.metricKey === 'spend' && f.dimensions.date === date,
      )?.value;

    // Delivered nothing.
    expect(spendOn('2026-08-01')).toBe('0.000000');
    // Never measured — a stronger and different claim.
    expect(spendOn('2026-08-02')).toBeNull();
  });

  it('carries provider, source and attribution as dimensions', async () => {
    const adapter = new SocialPaidMediaIntelligenceAdapter(buildReads());

    const set = await adapter.fetch(query());

    expect(set.facts[0].dimensions).toEqual({
      provider: 'meta',
      source: 'paid',
      attribution: 'account_default',
    });
  });

  it('does not duplicate the scope into dimensions', async () => {
    const adapter = new SocialPaidMediaIntelligenceAdapter(buildReads());

    const set = await adapter.fetch(query());

    for (const fact of set.facts) {
      expect(fact.dimensions).not.toHaveProperty('tenant');
      expect(fact.dimensions).not.toHaveProperty('workspace');
      expect(fact.dimensions).not.toHaveProperty('client');
    }
  });

  it('emits no ratio as a fact', async () => {
    const adapter = new SocialPaidMediaIntelligenceAdapter(buildReads());

    const set = await adapter.fetch(query());
    const keys = new Set(set.facts.map((fact) => fact.metricKey));

    for (const ratio of PAID_MEDIA_RATIOS) {
      expect(keys.has(ratio.key)).toBe(false);
    }
  });

  it('keeps every value as an exact decimal string', async () => {
    const adapter = new SocialPaidMediaIntelligenceAdapter(buildReads());

    const set = await adapter.fetch(query());

    for (const fact of set.facts) {
      expect(fact.value === null || typeof fact.value === 'string').toBe(true);
    }
  });

  it('reports provenance naming the read model, not a provider', async () => {
    const adapter = new SocialPaidMediaIntelligenceAdapter(buildReads());

    const set = await adapter.fetch(query());

    expect(set.provenance.canonicalSource).toBe('social_ad_metrics_daily');
    expect(set.provenance.attributionBasis).toBe('account_default');
    expect(set.provenance.ingestionMode).toBe('synced');
    expect(set.provenance.notes?.entityLevel).toBe('account');
  });

  /**
   * A ninety-day window spans dozens of runs plus every intraday convergence.
   * Listing them would outweigh the facts, for identifiers a consumer cannot
   * act on.
   */
  it('summarises sync evidence rather than listing run ids', async () => {
    const adapter = new SocialPaidMediaIntelligenceAdapter(buildReads());

    const set = await adapter.fetch(query());

    expect(JSON.stringify(set.provenance)).not.toContain('syncRunIds');
    expect(set.provenance.notes?.runDetail).toContain(
      '/social/analytics/freshness',
    );
  });

  it('reports freshness from the sync, not from the query clock', async () => {
    const adapter = new SocialPaidMediaIntelligenceAdapter(buildReads());

    const set = await adapter.fetch(query());

    expect(set.freshness.mode).toBe('synced');
    expect(set.freshness.asOf).toBe('2026-08-30T06:00:00.000Z');
    expect(set.freshness.isPartial).toBe(false);
  });

  it('flags a partial day inside the window', async () => {
    const reads = buildReads({
      freshness: jest
        .fn()
        .mockResolvedValue(
          freshness({ metrics: { latestPartialMetricDate: '2026-08-30' } }),
        ),
    });
    const adapter = new SocialPaidMediaIntelligenceAdapter(reads);

    expect((await adapter.fetch(query())).freshness.isPartial).toBe(true);
  });

  it('ignores a partial day outside the window', async () => {
    const reads = buildReads({
      freshness: jest
        .fn()
        .mockResolvedValue(
          freshness({ metrics: { latestPartialMetricDate: '2026-09-15' } }),
        ),
    });
    const adapter = new SocialPaidMediaIntelligenceAdapter(reads);

    expect((await adapter.fetch(query())).freshness.isPartial).toBe(false);
  });

  /**
   * Coverage comes from how far the sync has progressed, not from row counts:
   * an account that delivered nothing on a Sunday has no row for Sunday, and
   * counting rows would report a synced day as missing.
   */
  it('derives coverage from sync progress, not from rows present', async () => {
    const reads = buildReads({
      freshness: jest
        .fn()
        .mockResolvedValue(
          freshness({ metrics: { latestMetricDate: '2026-08-10' } }),
        ),
    });
    const adapter = new SocialPaidMediaIntelligenceAdapter(reads);

    const set = await adapter.fetch(query());

    expect(set.freshness.coverage).toEqual({
      expectedDays: 30,
      coveredDays: 10,
      basis: 'sync_progress',
    });
  });

  it('reports zero coverage when the sync has not reached the window', async () => {
    const reads = buildReads({
      freshness: jest
        .fn()
        .mockResolvedValue(
          freshness({ metrics: { latestMetricDate: '2026-07-01' } }),
        ),
    });
    const adapter = new SocialPaidMediaIntelligenceAdapter(reads);

    expect((await adapter.fetch(query())).freshness.coverage.coveredDays).toBe(
      0,
    );
  });

  it('caps coverage at the window even when the sync ran ahead of it', async () => {
    const reads = buildReads({
      freshness: jest
        .fn()
        .mockResolvedValue(
          freshness({ metrics: { latestMetricDate: '2026-12-31' } }),
        ),
    });
    const adapter = new SocialPaidMediaIntelligenceAdapter(reads);

    expect((await adapter.fetch(query())).freshness.coverage.coveredDays).toBe(
      30,
    );
  });

  /**
   * A disconnected account's stored history is still true and still the
   * client's. The read service refuses to filter on connection status, and the
   * adapter must not reintroduce that filter.
   */
  it('still answers for a disconnected connection', async () => {
    const reads = buildReads({
      freshness: jest.fn().mockResolvedValue({
        ...freshness(),
        connectionStatus: 'disconnected',
      }),
    });
    const adapter = new SocialPaidMediaIntelligenceAdapter(reads);

    const set = await adapter.fetch(query());

    expect(set.facts).toHaveLength(9);
    expect(set.facts.find((fact) => fact.metricKey === 'spend')?.value).toBe(
      '1000.000000',
    );
  });

  it('reports businessMode null, so Social standalone works without LeadFlow', async () => {
    const adapter = new SocialPaidMediaIntelligenceAdapter(buildReads());

    expect((await adapter.fetch(query())).businessMode).toBeNull();
  });

  it('refuses a missing subject rather than answering for none', async () => {
    const adapter = new SocialPaidMediaIntelligenceAdapter(buildReads());

    await expect(
      adapter.fetch(query({ subjectId: undefined })),
    ).rejects.toThrow('subjectId');
  });

  it('refuses an unsupported grain rather than returning an empty set', async () => {
    const adapter = new SocialPaidMediaIntelligenceAdapter(buildReads());

    await expect(
      adapter.fetch(query({ grain: 'week' as never })),
    ).rejects.toThrow('Unsupported grain');
  });
});

/**
 * The ratio *recipes* are declared in the shared contract; the arithmetic they
 * describe is `social-ad-kpi`'s. These assert the two agree.
 *
 * They live here rather than beside `PAID_MEDIA_RATIOS` because of the
 * dependency direction the whole layer rests on: `common/intelligence` must not
 * name a domain module, and a spec that imported `social-ad-kpi` from there
 * would make the shared contract's own suite depend on `social-integrations`.
 * Social may depend on the contract, so the check belongs on this side —
 * `common/intelligence` ← Social adapter → `social-ad-kpi`.
 */
describe('paid media ratio semantics against the shipped KPI implementation', () => {
  const SCALE = 1_000_000n;

  const inputs = (overrides: Record<string, bigint> = {}) => ({
    spend: 0n,
    impressions: 0n,
    clicks: 0n,
    linkClicks: 0n,
    leads: 0n,
    conversions: 0n,
    conversionValue: 0n,
    videoViews: 0n,
    ...overrides,
  });

  it('yields null on a zero denominator, never zero and never Infinity', () => {
    expect(divideScaled(100n * SCALE, 0n)).toBeNull();

    const kpis = deriveSocialAdKpis(inputs({ spend: 500n * SCALE }));

    expect(kpis.ctr).toBeNull();
    expect(kpis.cpc).toBeNull();
    expect(kpis.cpl).toBeNull();
  });

  /** The one case where zero is the answer rather than the absence of one. */
  it('reports ROAS of zero as a real result when spend is positive', () => {
    const kpis = deriveSocialAdKpis(
      inputs({ spend: 500n * SCALE, impressions: 1000n, clicks: 10n }),
    );

    expect(kpis.roas).toBe('0.000000');
    expect(kpis.roas).not.toBeNull();
  });

  it('reports ROAS as null only when spend — the denominator — is zero', () => {
    const kpis = deriveSocialAdKpis(inputs({ conversionValue: 100n * SCALE }));

    expect(kpis.roas).toBeNull();
  });

  /**
   * A quotient of two sums, not a mean of daily quotients — the reason ratios
   * are declared rather than emitted as facts.
   */
  it('computes a ratio at the aggregation level, not per day then averaged', () => {
    // Day one: 1 click on 1,000 impressions (0.1%).
    // Day two: 1 click on 1,000,000 impressions (0.0001%).
    const perDay = [
      deriveSocialAdKpis(inputs({ impressions: 1_000n, clicks: 1n })),
      deriveSocialAdKpis(inputs({ impressions: 1_000_000n, clicks: 1n })),
    ];

    const meanOfDailies = (Number(perDay[0].ctr) + Number(perDay[1].ctr)) / 2;

    const atAggregationLevel = deriveSocialAdKpis(
      inputs({ impressions: 1_001_000n, clicks: 2n }),
    );

    // The mean of the dailies is ~0.05%; the true CTR is ~0.0002%. Two orders
    // of magnitude apart, which is what a consumer would publish if ratios
    // travelled as facts.
    expect(meanOfDailies).toBeGreaterThan(0.04);
    expect(Number(atAggregationLevel.ctr)).toBeLessThan(0.001);
  });

  it('keeps money exact past the precision of a double', () => {
    // 0.1 + 0.2 in floating point is famously not 0.3.
    expect(0.1 + 0.2).not.toBe(0.3);

    const kpis = deriveSocialAdKpis(inputs({ spend: 300_000n, clicks: 1n }));

    expect(kpis.cpc).toBe('0.300000');
  });

  /** Every declared recipe names metrics the adapter actually emits. */
  it('names only metrics the paid media fact set carries', () => {
    for (const ratio of PAID_MEDIA_RATIOS) {
      expect(PAID_MEDIA_METRICS_BY_KEY.has(ratio.numerator)).toBe(true);
      expect(PAID_MEDIA_METRICS_BY_KEY.has(ratio.denominator)).toBe(true);
    }
  });
});
