import { BadRequestException } from '@nestjs/common';
import {
  MAX_ANALYTICS_PERIOD_DAYS,
  parseAnalyticsPeriod,
  previousAnalyticsPeriod,
} from './social-ad-analytics-period';

describe('parseAnalyticsPeriod', () => {
  it('counts an inclusive range', () => {
    expect(
      parseAnalyticsPeriod({ since: '2026-08-01', until: '2026-08-07' }),
    ).toEqual({ since: '2026-08-01', until: '2026-08-07', days: 7 });
  });

  it('counts a single day as one day', () => {
    expect(
      parseAnalyticsPeriod({ since: '2026-08-27', until: '2026-08-27' }),
    ).toEqual({ since: '2026-08-27', until: '2026-08-27', days: 1 });
  });

  it('refuses a reversed range', () => {
    expect(() =>
      parseAnalyticsPeriod({ since: '2026-08-27', until: '2026-08-01' }),
    ).toThrow(BadRequestException);
  });

  it('refuses a date that does not exist', () => {
    // `Date.UTC` rolls this into March; without the round-trip check the period
    // would silently shift and return real numbers for the wrong days.
    expect(() =>
      parseAnalyticsPeriod({ since: '2026-02-30', until: '2026-03-05' }),
    ).toThrow(BadRequestException);
  });

  it('refuses an instant, which would carry a timezone', () => {
    expect(() =>
      parseAnalyticsPeriod({
        since: '2026-08-01T00:00:00Z',
        until: '2026-08-07',
      }),
    ).toThrow(BadRequestException);
  });

  it('refuses anything that is not a string', () => {
    expect(() =>
      parseAnalyticsPeriod({ since: 20260801, until: '2026-08-07' }),
    ).toThrow(BadRequestException);
  });

  it('accepts a period of exactly the maximum length', () => {
    // 2026-08-27 minus 364 days.
    const period = parseAnalyticsPeriod({
      since: '2025-08-28',
      until: '2026-08-27',
    });

    expect(period.days).toBe(MAX_ANALYTICS_PERIOD_DAYS);
  });

  it('refuses a period one day past the maximum', () => {
    expect(() =>
      parseAnalyticsPeriod({ since: '2025-08-27', until: '2026-08-27' }),
    ).toThrow(BadRequestException);
  });

  it('accepts a period in the future, which simply matches no rows', () => {
    // A read has nothing to stamp, so the closed-day rule that governs ingests
    // has no business here. An empty answer is the truthful one.
    expect(() =>
      parseAnalyticsPeriod({ since: '2099-01-01', until: '2099-01-07' }),
    ).not.toThrow();
  });

  it('crosses a leap day without shifting', () => {
    const period = parseAnalyticsPeriod({
      since: '2028-02-27',
      until: '2028-03-01',
    });

    expect(period.days).toBe(4);
  });
});

describe('previousAnalyticsPeriod', () => {
  it('is the adjacent range of the same length', () => {
    const period = parseAnalyticsPeriod({
      since: '2026-08-21',
      until: '2026-08-27',
    });

    expect(previousAnalyticsPeriod(period)).toEqual({
      since: '2026-08-14',
      until: '2026-08-20',
      days: 7,
    });
  });

  it('leaves no gap and no overlap with the period it precedes', () => {
    const period = parseAnalyticsPeriod({
      since: '2026-08-21',
      until: '2026-08-27',
    });
    const previous = previousAnalyticsPeriod(period);

    // The day after the comparison ends is the day the period starts.
    const dayAfter = new Date(`${previous.until}T00:00:00Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);

    expect(dayAfter.toISOString().slice(0, 10)).toBe(period.since);
  });

  it('compares a single day against the day before it', () => {
    const period = parseAnalyticsPeriod({
      since: '2026-08-27',
      until: '2026-08-27',
    });

    expect(previousAnalyticsPeriod(period)).toEqual({
      since: '2026-08-26',
      until: '2026-08-26',
      days: 1,
    });
  });

  it('compares equal day counts across months of different lengths', () => {
    // February against "January" as calendar months would compare 28 days with
    // 31 and lose three days of spend to nothing.
    const february = parseAnalyticsPeriod({
      since: '2026-02-01',
      until: '2026-02-28',
    });
    const previous = previousAnalyticsPeriod(february);

    expect(previous.days).toBe(february.days);
    expect(previous).toEqual({
      since: '2026-01-04',
      until: '2026-01-31',
      days: 28,
    });
  });

  it('crosses a year boundary', () => {
    const period = parseAnalyticsPeriod({
      since: '2026-01-01',
      until: '2026-01-07',
    });

    expect(previousAnalyticsPeriod(period)).toEqual({
      since: '2025-12-25',
      until: '2025-12-31',
      days: 7,
    });
  });
});
