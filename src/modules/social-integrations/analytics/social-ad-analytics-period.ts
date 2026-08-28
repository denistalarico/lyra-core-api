import { BadRequestException } from '@nestjs/common';
import { shiftDay } from '../sync/insights-window';

/**
 * How many days one analytics read may span.
 *
 * Not the sync module's `MAX_INSIGHTS_WINDOW_DAYS`, and deliberately not
 * reusing it. That constant is 90 because 90 days is Meta's restatement horizon
 * — it bounds how much a *provider* call may ask for. This one bounds a local
 * aggregation over rows that are already stored, so the restatement horizon has
 * nothing to say about it. A year is the longest range a dashboard offers, and
 * the comparison window doubles the scan, so the real ceiling is two years of
 * rows in one request.
 */
export const MAX_ANALYTICS_PERIOD_DAYS = 365;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** An inclusive calendar range in the ad account's own timezone. */
export type SocialAdAnalyticsPeriod = {
  since: string;
  until: string;
  /** Inclusive day count: a single-day period is `1`, not `0`. */
  days: number;
};

/**
 * Validates a requested range, or refuses it.
 *
 * The dates stay calendar days throughout. They are parsed as UTC only to order
 * them and to count them — never to convert anything — because the days belong
 * to the ad account's timezone, which is stored on every fact row. Re-expressing
 * them in the server's zone or the caller's would shift the range by a day for
 * any account far enough from either.
 *
 * Deliberately absent: any check against today. An analytics read may name a
 * future date and will simply match no rows, which is the truthful answer. The
 * closed-day rule exists to stop an *ingest* from stamping an open day as final;
 * a read has nothing to stamp.
 */
export function parseAnalyticsPeriod(input: {
  since: unknown;
  until: unknown;
}): SocialAdAnalyticsPeriod {
  const since = requireDay(input.since, 'since');
  const until = requireDay(input.until, 'until');

  if (since.time > until.time) {
    throw new BadRequestException('since must not be after until.');
  }

  const days = Math.round((until.time - since.time) / MS_PER_DAY) + 1;

  if (days > MAX_ANALYTICS_PERIOD_DAYS) {
    throw new BadRequestException(
      `The period must not exceed ${MAX_ANALYTICS_PERIOD_DAYS} days.`,
    );
  }

  return { since: since.text, until: until.text, days };
}

/**
 * The immediately preceding range of the same length.
 *
 * Equal length and adjacency are both required for the comparison to mean
 * anything. A 7-day period compares against the 7 days that ended the day
 * before it starts — not against "last month", and not against the same dates
 * one year earlier, both of which are different questions with different
 * seasonal content.
 *
 * Length in days rather than calendar months is what keeps the two sides
 * commensurable: February against January as months compares 28 days with 31,
 * and the shorter one loses by three days of spend that nothing accounts for.
 */
export function previousAnalyticsPeriod(
  period: SocialAdAnalyticsPeriod,
): SocialAdAnalyticsPeriod {
  const until = shiftDay(period.since, -1);

  return {
    since: shiftDay(until, -(period.days - 1)),
    until,
    days: period.days,
  };
}

/**
 * One calendar day, checked for shape *and* for existing.
 *
 * The round-trip comparison is what rejects `2026-02-30`: `Date.UTC` accepts it
 * and rolls it forward into March, so a value that formats back to something
 * other than what arrived was never a real date. Without this the period would
 * silently shift, and a shifted period returns real numbers for the wrong days.
 */
function requireDay(
  value: unknown,
  field: string,
): { text: string; time: number } {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) {
    throw new BadRequestException(`${field} must be a date as YYYY-MM-DD.`);
  }

  const [year, month, day] = value.split('-').map(Number);
  const time = Date.UTC(year, month - 1, day);

  if (
    Number.isNaN(time) ||
    new Date(time).toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${field} is not a real calendar date.`);
  }

  return { text: value, time };
}
