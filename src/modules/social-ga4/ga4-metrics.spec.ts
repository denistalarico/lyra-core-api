import {
  EMPTY_GA4_SUMS,
  ga4Change,
  parseGa4Period,
  previousGa4Period,
  toGa4Totals,
} from './ga4-metrics';

describe('GA4 period arithmetic', () => {
  it('computes the engagement rate as Σ engaged ÷ Σ sessions, not a mean of daily rates', () => {
    // Day 1: 10/100 = 10 %; day 2: 90/100 = 90 %. A mean of rates says 50 %,
    // the same as the sums here, so use unequal days to tell them apart.
    const totals = toGa4Totals({
      ...EMPTY_GA4_SUMS,
      sessions: 100 + 900,
      engagedSessions: 10 + 90,
    });

    expect(totals.engagementRate).toBeCloseTo(0.1);
  });

  it('weights the average session duration by sessions', () => {
    const totals = toGa4Totals({
      ...EMPTY_GA4_SUMS,
      sessions: 100 + 300,
      sessionSeconds: 10 * 100 + 50 * 300,
    });

    expect(totals.avgSessionSeconds).toBeCloseTo(40);
  });

  it('returns null rates when there are no sessions', () => {
    expect(toGa4Totals(EMPTY_GA4_SUMS).engagementRate).toBeNull();
  });

  it('reports a null percent change from a zero base', () => {
    expect(ga4Change(5, 0)?.percent).toBeNull();
  });

  it('reports the percent change against the previous period', () => {
    expect(ga4Change(150, 100)?.percent).toBe(50);
  });

  it('reports no change when either side has no reading', () => {
    expect(ga4Change(null, 10)).toBeNull();
  });

  it('derives the previous period with the same length, immediately before', () => {
    const period = parseGa4Period('2026-11-08', '2026-11-14')!;

    expect(previousGa4Period(period)).toEqual({
      since: '2026-11-01',
      until: '2026-11-07',
      days: 7,
    });
  });

  it('rejects an impossible calendar date', () => {
    expect(parseGa4Period('2026-02-31', '2026-03-02')).toBeNull();
  });

  it('rejects an inverted period', () => {
    expect(parseGa4Period('2026-11-10', '2026-11-01')).toBeNull();
  });

  it('rejects a period longer than a year', () => {
    expect(parseGa4Period('2025-01-01', '2026-11-01')).toBeNull();
  });
});
