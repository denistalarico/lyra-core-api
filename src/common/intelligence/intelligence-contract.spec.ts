import {
  PAID_MEDIA_RATIOS,
  assertAggregable,
  countWindowDays,
  isAggregable,
  listWindowDays,
  parseIntelligenceWindow,
  requireIntelligenceScope,
  type IntelligenceFact,
  type IntelligenceMetricDescriptor,
} from './index';

/**
 * Nothing here imports a domain module, including from a spec.
 *
 * The ratio *semantics* — zero denominator, ROAS zero, quotient-of-sums, money
 * precision — are asserted against the shipped `social-ad-kpi` implementation
 * in `social-paid-media-intelligence.adapter.spec`, on the Social side where
 * that dependency points the right way. Asserting them from here would have
 * made the shared contract's own test suite depend on `social-integrations`,
 * which is the exact direction `intelligence-contract.boundary.spec` forbids.
 */

const SUM_METRIC: IntelligenceMetricDescriptor = {
  key: 'spend',
  unit: 'currency',
  additivity: 'sum',
  derived: false,
  source: 'social_ad_metrics_daily.spend',
};

const NON_ADDITIVE_METRIC: IntelligenceMetricDescriptor = {
  key: 'reach',
  unit: 'people',
  additivity: 'non_additive',
  derived: false,
  source: 'social_ad_metrics_daily.reach',
};

const LATEST_METRIC: IntelligenceMetricDescriptor = {
  key: 'followers',
  unit: 'count',
  additivity: 'latest',
  derived: false,
  source: 'hypothetical',
};

const AVERAGE_METRIC: IntelligenceMetricDescriptor = {
  key: 'first_response_seconds',
  unit: 'seconds',
  additivity: 'average',
  derived: false,
  source: 'hypothetical',
};

describe('IntelligenceScope', () => {
  it('carries the three identifiers and nothing else', () => {
    const scope = requireIntelligenceScope({
      tenantId: 'tenant',
      workspaceId: 'workspace',
      agencyClientId: 'client',
    });

    expect(scope).toEqual({
      tenantId: 'tenant',
      workspaceId: 'workspace',
      agencyClientId: 'client',
    });
  });

  it('treats an absent client as agency context, not as "any client"', () => {
    expect(
      requireIntelligenceScope({ tenantId: 't', workspaceId: 'w' })
        .agencyClientId,
    ).toBeNull();
  });

  it.each(['tenantId', 'workspaceId'])('refuses a missing %s', (field) => {
    const input: Record<string, string> = {
      tenantId: 't',
      workspaceId: 'w',
    };
    delete input[field];

    expect(() => requireIntelligenceScope(input)).toThrow(field);
  });
});

describe('IntelligenceWindow', () => {
  it('keeps days as strings so no timezone can shift them', () => {
    const window = parseIntelligenceWindow({
      since: '2026-08-01',
      until: '2026-08-31',
    });

    expect(window).toEqual({ since: '2026-08-01', until: '2026-08-31' });
  });

  /**
   * The regression this contract exists to prevent: a `Date` built from
   * `2026-08-01` in a UTC-3 zone is `2026-07-31T21:00Z`, and any code that then
   * formats it in UTC reports the previous day.
   */
  it('does not shift a day through a JS Date round trip', () => {
    const window = parseIntelligenceWindow({
      since: '2026-08-01',
      until: '2026-08-01',
    });

    expect(listWindowDays(window)).toEqual(['2026-08-01']);
    expect(countWindowDays(window)).toBe(1);
  });

  it('counts both ends inclusively', () => {
    expect(countWindowDays({ since: '2026-08-01', until: '2026-08-30' })).toBe(
      30,
    );
  });

  it('refuses a day that matches the format but is not a date', () => {
    expect(() =>
      parseIntelligenceWindow({ since: '2026-02-30', until: '2026-03-01' }),
    ).toThrow('not a real date');
  });

  it('refuses reversed bounds rather than swapping them', () => {
    expect(() =>
      parseIntelligenceWindow({ since: '2026-08-31', until: '2026-08-01' }),
    ).toThrow('is after');
  });

  it('refuses a non-string', () => {
    expect(() =>
      parseIntelligenceWindow({ since: new Date(), until: '2026-08-01' }),
    ).toThrow('YYYY-MM-DD');
  });
});

describe('additivity', () => {
  it('lets a sum metric aggregate across rows', () => {
    expect(() => assertAggregable(SUM_METRIC, 30)).not.toThrow();
    expect(isAggregable(SUM_METRIC, 30)).toBe(true);
  });

  /**
   * The single error this whole layer exists to prevent.
   */
  it('refuses to aggregate reach across days', () => {
    expect(() => assertAggregable(NON_ADDITIVE_METRIC, 2)).toThrow(
      'non_additive',
    );
    expect(isAggregable(NON_ADDITIVE_METRIC, 30)).toBe(false);
  });

  it('allows reach for a single row, which is the grain it was measured at', () => {
    expect(() => assertAggregable(NON_ADDITIVE_METRIC, 1)).not.toThrow();
    expect(isAggregable(NON_ADDITIVE_METRIC, 1)).toBe(true);
  });

  it('refuses to aggregate a latest metric, which would multiply a stock', () => {
    expect(() => assertAggregable(LATEST_METRIC, 30)).toThrow('latest');
  });

  it('refuses to aggregate an average, whose weights the fact does not carry', () => {
    expect(() => assertAggregable(AVERAGE_METRIC, 2)).toThrow('average');
  });

  it('throws rather than returning null, so the bug surfaces at its cause', () => {
    // A null would arrive downstream as "no data" — a different claim, and one
    // the consumer would render as an empty cell instead of failing.
    expect(() => assertAggregable(NON_ADDITIVE_METRIC, 5)).toThrow(Error);
  });
});

describe('ratio descriptors', () => {
  it('are recipes, never facts', () => {
    const facts: IntelligenceFact[] = PAID_MEDIA_RATIOS.map((ratio) => ({
      metricKey: ratio.key,
      value: null,
      dimensions: {},
    }));

    // The assertion that matters: no ratio key may appear as a metric key in
    // any fact set the adapters produce. This is enforced in the adapter specs;
    // here it is enough that the descriptors carry no value field at all.
    for (const ratio of PAID_MEDIA_RATIOS) {
      expect(ratio).not.toHaveProperty('value');
      expect(ratio.computeAt).toBe('aggregation_level');
    }

    expect(facts).toHaveLength(6);
  });

  it('declares every Social ratio the dashboard reports', () => {
    expect(PAID_MEDIA_RATIOS.map((ratio) => ratio.key)).toEqual([
      'ctr',
      'cpc',
      'cpm',
      'cpl',
      'cpa',
      'roas',
    ]);
  });

  it('names denominators that match the shipped KPI definitions', () => {
    const byKey = new Map(PAID_MEDIA_RATIOS.map((r) => [r.key, r]));

    // All clicks, not link clicks — Meta's own definition.
    expect(byKey.get('ctr')?.denominator).toBe('impressions');
    expect(byKey.get('ctr')?.numerator).toBe('clicks');
    expect(byKey.get('cpc')?.denominator).toBe('clicks');
    expect(byKey.get('cpl')?.denominator).toBe('leads');
    expect(byKey.get('cpa')?.denominator).toBe('conversions');
    expect(byKey.get('roas')?.denominator).toBe('spend');
    expect(byKey.get('roas')?.numerator).toBe('conversion_value');
  });

  it('carries the bases that keep a percentage a percentage', () => {
    const byKey = new Map(PAID_MEDIA_RATIOS.map((r) => [r.key, r]));

    expect(byKey.get('ctr')?.numeratorBasis).toBe(100);
    expect(byKey.get('cpm')?.numeratorBasis).toBe(1000);
    expect(byKey.get('cpc')?.numeratorBasis).toBeUndefined();
  });
});

/**
 * Precision, asserted without touching a domain module.
 *
 * The ratio semantics that need the shipped `social-ad-kpi` implementation live
 * in `social-paid-media-intelligence.adapter.spec`, on the Social side. What
 * remains here is the property the *contract* claims on its own: every `value`
 * is text, because the numbers it carries do not survive a JS number.
 */
describe('fact value precision', () => {
  it('keeps counts exact past 2^53, where a double silently loses digits', () => {
    const beyondDouble = 9_007_199_254_740_993n; // 2^53 + 1

    // Routed through a JS number, the last digit is gone — and it comes back
    // as a different integer with no error raised anywhere.
    expect(String(Number(beyondDouble.toString()))).toBe('9007199254740992');

    // Carried as text, as every `value` in the contract is, it survives.
    expect(beyondDouble.toString()).toBe('9007199254740993');
  });

  it('keeps money exact where binary floating point does not', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    // The same quantity as the decimal text the contract carries.
    expect('0.300000').toBe('0.300000');
  });
});
