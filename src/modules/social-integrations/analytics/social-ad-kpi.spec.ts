import {
  deriveChange,
  deriveSocialAdKpis,
  divideScaled,
  formatDerived,
} from './social-ad-kpi';

const SCALE = 1_000_000n;

/** A money amount written the way a person would, scaled the way a column is. */
function money(text: string): bigint {
  const [whole, fraction = ''] = text.split('.');

  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
}

const NO_ACTIVITY = {
  spend: 0n,
  impressions: 0n,
  clicks: 0n,
  linkClicks: 0n,
  leads: 0n,
  conversions: 0n,
  conversionValue: 0n,
  videoViews: 0n,
};

describe('divideScaled', () => {
  it('answers null rather than zero when the denominator is zero', () => {
    // The distinction the whole module exists for: "no clicks yet" and "a cost
    // per click of zero" are different facts, and only one of them is free.
    expect(divideScaled(money('100'), 0n)).toBeNull();
  });

  it('keeps six decimals through the division', () => {
    // 1 / 3 truncated before scaling would be 0.
    expect(formatDerived(divideScaled(1n * SCALE, 3n * SCALE))).toBe(
      '0.333333',
    );
  });

  it('rounds half up at the sixth decimal, as the numeric column does', () => {
    // 2/3 = 0.6666666… — the seventh digit is 6, so the sixth rounds up.
    expect(formatDerived(divideScaled(2n * SCALE, 3n * SCALE))).toBe(
      '0.666667',
    );
  });
});

describe('deriveSocialAdKpis', () => {
  it('derives every KPI from summed numerators and denominators', () => {
    const kpis = deriveSocialAdKpis({
      spend: money('1000'),
      impressions: 100_000n,
      clicks: 2_000n,
      linkClicks: 1_500n,
      leads: 40n,
      conversions: money('25'),
      conversionValue: money('5000'),
      videoViews: 8_000n,
    });

    expect(kpis).toEqual({
      // 2000 / 100000 = 2%
      ctr: '2.000000',
      // 1000 / 2000
      cpc: '0.500000',
      // 1000 / (100000/1000)
      cpm: '10.000000',
      // 1000 / 40
      cpl: '25.000000',
      // 1000 / 25
      cpa: '40.000000',
      // 5000 / 1000
      roas: '5.000000',
    });
  });

  it('answers null for every KPI when nothing was delivered', () => {
    // A campaign that has not started must not report a CTR of 0%, which reads
    // as "shown to people, clicked by none".
    expect(deriveSocialAdKpis(NO_ACTIVITY)).toEqual({
      ctr: null,
      cpc: null,
      cpm: null,
      cpl: null,
      cpa: null,
      roas: null,
    });
  });

  it('reports a cost per lead only when there are leads, even with spend', () => {
    const kpis = deriveSocialAdKpis({
      ...NO_ACTIVITY,
      spend: money('500'),
      impressions: 10_000n,
    });

    // Money spent and no leads is not "R$ 0 per lead".
    expect(kpis.cpl).toBeNull();
    expect(kpis.cpa).toBeNull();
  });

  it('reports a real zero ROAS when money was spent and nothing came back', () => {
    const kpis = deriveSocialAdKpis({
      ...NO_ACTIVITY,
      spend: money('500'),
      conversionValue: 0n,
    });

    // Not null, unlike the cost-per KPIs above, and the asymmetry is the point:
    // ROAS divides by *spend*, which is non-zero here, so the quotient is
    // defined. "We spent R$ 500 and earned nothing back" is a fact worth
    // showing; nulling it would hide the worst-performing campaigns.
    expect(kpis.roas).toBe('0.000000');
  });

  it('divides by all clicks rather than link clicks, matching Ads Manager', () => {
    const kpis = deriveSocialAdKpis({
      ...NO_ACTIVITY,
      spend: money('100'),
      impressions: 10_000n,
      clicks: 500n,
      linkClicks: 100n,
    });

    // With link clicks the CTR would be 1% and the CPC R$ 1.00 — both would
    // fail to reconcile against Meta's own reporting.
    expect(kpis.ctr).toBe('5.000000');
    expect(kpis.cpc).toBe('0.200000');
  });

  it('handles fractional conversions without rounding them to whole ones', () => {
    const kpis = deriveSocialAdKpis({
      ...NO_ACTIVITY,
      spend: money('100'),
      // One conversion credited across two ads.
      conversions: money('0.5'),
    });

    // Rounding the denominator to 1 would report R$ 100 and understate the cost.
    expect(kpis.cpa).toBe('200.000000');
  });

  it('stays exact across a sum no double could represent', () => {
    // 0.1 + 0.2 in binary floating point is 0.30000000000000004; a quarter of
    // spend accumulates that error into the cents a client is invoiced for.
    const kpis = deriveSocialAdKpis({
      ...NO_ACTIVITY,
      spend: money('0.1') + money('0.2'),
      clicks: 1n,
    });

    expect(kpis.cpc).toBe('0.300000');
  });

  it('does not lose precision on counts above the safe integer ceiling', () => {
    const kpis = deriveSocialAdKpis({
      ...NO_ACTIVITY,
      spend: money('1'),
      // Larger than 2^53: a JS number would round this and change the CTR.
      impressions: 9_007_199_254_740_993n,
      clicks: 9_007_199_254_740_993n,
    });

    expect(kpis.ctr).toBe('100.000000');
  });
});

describe('deriveChange', () => {
  it('reports absolute and percent movement', () => {
    expect(deriveChange(money('150'), money('100'))).toEqual({
      absolute: '50.000000',
      percent: '50.000000',
    });
  });

  it('signs a decline on both fields', () => {
    expect(deriveChange(money('80'), money('100'))).toEqual({
      absolute: '-20.000000',
      percent: '-20.000000',
    });
  });

  it('answers a null percent when the previous period was zero', () => {
    // Every campaign's first period. Growth from nothing has no percentage, and
    // both `+100%` and `+∞%` are inventions.
    expect(deriveChange(money('100'), 0n)).toEqual({
      absolute: '100.000000',
      percent: null,
    });
  });

  it('reports no movement between two identical periods', () => {
    expect(deriveChange(money('100'), money('100'))).toEqual({
      absolute: '0.000000',
      percent: '0.000000',
    });
  });

  it('reports a zero current period against a real one as a full decline', () => {
    expect(deriveChange(0n, money('100'))).toEqual({
      absolute: '-100.000000',
      percent: '-100.000000',
    });
  });
});
