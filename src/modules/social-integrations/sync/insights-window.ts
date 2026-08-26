import { BadRequestException } from '@nestjs/common';
import { SocialAdInsightsWindowNotClosedError } from './social-ad-insights.error';

/**
 * How many days one manual call may ask for.
 *
 * Not an arbitrary round number: 90 days is the horizon over which Meta still
 * restates data, so it is the longest window a re-read can usefully cover, and
 * at campaign level it is already 90 rows per campaign in one synchronous
 * request. Anything larger belongs to the async job API, which is S2.5's
 * problem, not a bigger loop here.
 */
export const MAX_INSIGHTS_WINDOW_DAYS = 90;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** A validated, inclusive calendar window in the ad account's own timezone. */
export type InsightsWindow = {
  since: string;
  until: string;
  /** Inclusive day count: a window of one day is `1`, not `0`. */
  days: number;
};

/**
 * Validates the requested window, or refuses it.
 *
 * The dates are calendar days and stay calendar days. They are parsed as UTC
 * *only* to count how many there are and to check the order — never to convert
 * anything — because the window belongs to the ad account's timezone and this
 * process has no business re-expressing it in another one. A frontend that
 * sent an instant would be sending a timezone with it, which is why the shape
 * accepted here is `YYYY-MM-DD` and nothing else.
 */
export function parseInsightsWindow(input: {
  since: unknown;
  until: unknown;
}): InsightsWindow {
  const since = requireDay(input.since, 'since');
  const until = requireDay(input.until, 'until');

  if (since.time > until.time) {
    throw new BadRequestException('since must not be after until.');
  }

  const days = Math.round((until.time - since.time) / MS_PER_DAY) + 1;

  if (days > MAX_INSIGHTS_WINDOW_DAYS) {
    throw new BadRequestException(
      `The window must not exceed ${MAX_INSIGHTS_WINDOW_DAYS} days.`,
    );
  }

  return { since: since.text, until: until.text, days };
}

/**
 * Refuses a window that reaches into a day the ad account has not finished.
 *
 * Naming the window explicitly is not the same as the window being settled. A
 * request for "up to today" asks for a day that is still accumulating: the
 * numbers are real but incomplete, and this slice writes every row with
 * `is_partial = false`. Storing an open day under that flag makes an unfinished
 * total indistinguishable from a final one, and the row that says "yesterday we
 * spent R$ 3" never corrects itself unless something re-reads it — which is
 * exactly the job of the intraday sync that does not exist yet.
 *
 * So the rule for the manual endpoint is `until <= D-1`, and D is the ad
 * account's own day. Not the browser's, which is a timezone chosen by whoever
 * happens to be logged in; not the database server's `CURRENT_DATE`, which is
 * the timezone of a machine that has nothing to do with this account. An
 * account in `Pacific/Auckland` has already finished a day that is still
 * mid-afternoon in São Paulo, and vice versa — using anybody else's clock either
 * rejects a settled day or accepts an open one.
 *
 * `now` is a parameter so the boundary is testable at the hours where it
 * actually matters: the ones between the account's midnight and UTC's.
 */
export function assertClosedInsightsWindow(
  window: InsightsWindow,
  timezone: string,
  now: Date = new Date(),
): void {
  const maxUntil = previousDay(currentDayIn(timezone, now));

  // Only `until` needs checking: `since <= until` is already established, so a
  // settled `until` guarantees a settled window.
  if (window.until > maxUntil) {
    throw new SocialAdInsightsWindowNotClosedError(maxUntil, timezone);
  }
}

/**
 * Today's calendar date in an IANA zone, as `YYYY-MM-DD`.
 *
 * `en-CA` formats exactly that way, which avoids reassembling the parts by
 * hand. The zone is the one the credential resolver already refused to default:
 * an unknown zone stops a read long before this line.
 */
function currentDayIn(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** The calendar day before, computed on the date alone — no zone involved. */
function previousDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, date) - MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

/**
 * One calendar day, checked for shape *and* for existing.
 *
 * The round-trip comparison is what rejects `2026-02-30`: `Date.UTC` accepts it
 * and rolls it forward to March 2nd, so a value that formats back to something
 * other than what arrived was never a real date. Without this the window would
 * silently shift, which is the same class of bug as converting the timezone.
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
