import {
  BENCHMARK_METRICS,
  BENCHMARK_METRICS_BY_KEY,
  MIN_CONTRIBUTOR_COVERAGE_DAYS,
  resolveBenchmarkWindow,
  type BenchmarkWindowKey,
} from './intelligence-benchmark';
import { computePercentiles } from './intelligence-percentiles';

describe('benchmark contract', () => {
  describe('metrics', () => {
    it('declares only Phase A paid-media metrics', () => {
      expect(BENCHMARK_METRICS.map((metric) => metric.key)).toEqual([
        'paid_spend_minor_units',
        'paid_impressions',
        'paid_clicks',
        'paid_link_clicks',
        'paid_provider_leads',
      ]);
    });

    /**
     * Reach is excluded because it is non-additive (§16).
     *
     * A contributor's window value would have to be a sum of daily reach, and
     * that sum measures nothing — Meta de-duplicates people within each day, so
     * two days share an unknown number of the same people.
     */
    it('excludes reach and every Phase B metric', () => {
      const keys = BENCHMARK_METRICS.map((metric) => metric.key) as string[];

      for (const forbidden of [
        'reach',
        'paid_reach',
        'conversations',
        'qualified_leads',
        'opportunities',
        'won',
        'won_value',
        'revenue',
      ]) {
        expect(keys).not.toContain(forbidden);
      }
    });

    it('requires a currency split for monetary metrics only', () => {
      expect(
        BENCHMARK_METRICS_BY_KEY.get('paid_spend_minor_units')
          ?.requiresCurrency,
      ).toBe(true);

      for (const key of [
        'paid_impressions',
        'paid_clicks',
        'paid_link_clicks',
        'paid_provider_leads',
      ]) {
        expect(BENCHMARK_METRICS_BY_KEY.get(key)?.requiresCurrency).toBe(false);
      }
    });

    it('carries a definition version on every metric', () => {
      for (const metric of BENCHMARK_METRICS) {
        expect(metric.definitionVersion).toMatch(/^i6\..+\.v\d+$/);
      }
    });

    /**
     * The messaging caveat must survive into the response.
     *
     * A messaging-objective advertiser contributes a real `0` here, because the
     * five `onsite_conversion.messaging_*` action types are deliberately
     * uncounted upstream. A reader who takes this as "leads the business
     * received" draws the wrong conclusion, so the limitation is contractual
     * rather than documentary.
     */
    it('states the messaging limitation on provider leads', () => {
      expect(
        BENCHMARK_METRICS_BY_KEY.get('paid_provider_leads')?.limitation,
      ).toMatch(/messaging/i);
    });

    it('names spend in minor units and forbids FX', () => {
      const spend = BENCHMARK_METRICS_BY_KEY.get('paid_spend_minor_units');

      expect(spend?.unit).toBe('currency_minor_units');
      expect(spend?.limitation).toMatch(/No FX/i);
    });
  });

  describe('window', () => {
    /**
     * Today is excluded, always.
     *
     * Intraday rows are `is_partial` and a contributor whose day is three hours
     * old would enter the distribution with a near-zero value that reads as poor
     * performance rather than as an incomplete day.
     */
    it('ends yesterday and spans thirty completed days', () => {
      const window = resolveBenchmarkWindow(
        'trailing_30_completed_days_v1',
        new Date('2026-09-05T12:00:00Z'),
      );

      expect(window.until).toBe('2026-09-04');
      expect(window.since).toBe('2026-08-06');
      expect(window.days).toBe(30);
      expect(window.timezone).toBe('UTC');
    });

    it('is stable across the day it is asked on', () => {
      const morning = resolveBenchmarkWindow(
        'trailing_30_completed_days_v1',
        new Date('2026-09-05T00:00:01Z'),
      );
      const evening = resolveBenchmarkWindow(
        'trailing_30_completed_days_v1',
        new Date('2026-09-05T23:59:59Z'),
      );

      expect(morning).toEqual(evening);
    });

    it('rolls forward exactly one day at the UTC boundary', () => {
      const before = resolveBenchmarkWindow(
        'trailing_30_completed_days_v1',
        new Date('2026-09-05T23:59:59Z'),
      );
      const after = resolveBenchmarkWindow(
        'trailing_30_completed_days_v1',
        new Date('2026-09-06T00:00:00Z'),
      );

      expect(before.until).toBe('2026-09-04');
      expect(after.until).toBe('2026-09-05');
    });

    it('crosses a month boundary correctly', () => {
      const window = resolveBenchmarkWindow(
        'trailing_30_completed_days_v1',
        new Date('2026-01-15T06:00:00Z'),
      );

      expect(window.until).toBe('2026-01-14');
      expect(window.since).toBe('2025-12-16');
    });

    /**
     * A window key outside the enum is refused rather than defaulted.
     *
     * The cast is the point of the test: TypeScript already forbids this, so
     * the only way it arrives is from untyped input crossing a boundary — and
     * silently substituting the default window there would answer a question
     * nobody asked, under a label saying otherwise.
     */
    it('refuses an unsupported window key', () => {
      const unsupported = 'last_7_days' as BenchmarkWindowKey;

      expect(() => resolveBenchmarkWindow(unsupported, new Date())).toThrow(
        /Unsupported/,
      );
    });
  });

  describe('percentiles', () => {
    /**
     * The linear-interpolation definition, matching PostgreSQL's
     * `percentile_cont`, so a future move into SQL would not shift published
     * numbers.
     */
    it('interpolates between ranks', () => {
      expect(computePercentiles([1, 2, 3, 4, 5])).toEqual({
        p25: 2,
        median: 3,
        p75: 4,
      });
    });

    it('interpolates on an even-sized sample', () => {
      expect(computePercentiles([10, 20, 30, 40])).toEqual({
        p25: 17.5,
        median: 25,
        p75: 32.5,
      });
    });

    it('does not depend on input order', () => {
      expect(computePercentiles([5, 1, 4, 2, 3])).toEqual(
        computePercentiles([1, 2, 3, 4, 5]),
      );
    });

    /**
     * No silent outlier removal (§20).
     *
     * The median is robust *because* the extreme value is present and outvoted,
     * not because it was dropped. Winsorization would change the p75 without
     * anything in the response saying so.
     */
    it('keeps outliers in the sample', () => {
      const withOutlier = computePercentiles([1, 2, 3, 4, 1_000_000]);

      expect(withOutlier.median).toBe(3);
      expect(withOutlier.p75).toBe(4);
    });

    it('refuses an empty sample', () => {
      expect(() => computePercentiles([])).toThrow();
    });
  });

  it('declares a minimum contributor coverage', () => {
    expect(MIN_CONTRIBUTOR_COVERAGE_DAYS).toBe(7);
  });
});
