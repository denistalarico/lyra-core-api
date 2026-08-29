/**
 * The period a fact set covers, as calendar days.
 *
 * Date-only, inclusive at both ends, and carried as `YYYY-MM-DD` strings rather
 * than `Date` objects. That choice is the whole point of this file.
 *
 * A `Date` is an instant, and the instant that prints as `2026-08-28` in São
 * Paulo prints as `2026-08-29` in UTC. Ad delivery is bucketed by the *ad
 * account's* calendar day, so a window that travelled as instants would shift
 * by one day somewhere between the caller and the query — silently, and only for
 * accounts whose timezone is behind or ahead of the server's. Strings have no
 * timezone to lose.
 *
 * The same reasoning applies in reverse for LeadFlow, whose facts are instants:
 * that adapter widens these days into instants itself, using the zone it can
 * defend, instead of receiving a pre-widened range whose zone nobody recorded.
 */
export type IntelligenceWindow = {
  /** Inclusive first day, `YYYY-MM-DD`. */
  since: string;
  /** Inclusive last day, `YYYY-MM-DD`. */
  until: string;
};

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A window, or a thrown error — never a silently corrected one.
 *
 * Validates the calendar as well as the format: `2026-02-30` matches the pattern
 * and is not a day. Re-formatting the parsed date and comparing catches every
 * such case without a month-length table, because `Date.UTC` normalises an
 * overflowing day into the next month and the round trip then disagrees.
 *
 * Reversed bounds are refused rather than swapped. A caller that sent them
 * backwards has a bug, and quietly fixing it means the bug ships and the numbers
 * it produces look plausible.
 */
export function parseIntelligenceWindow(input: {
  since: unknown;
  until: unknown;
}): IntelligenceWindow {
  const since = parseDay(input.since, 'since');
  const until = parseDay(input.until, 'until');

  if (since > until) {
    throw new Error(
      `IntelligenceWindow: since (${since}) is after until (${until}).`,
    );
  }

  return { since, until };
}

function parseDay(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) {
    throw new Error(
      `IntelligenceWindow: ${field} must be a YYYY-MM-DD date string.`,
    );
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`IntelligenceWindow: ${field} is not a real date.`);
  }

  return value;
}

/** Days in the window, inclusive of both ends. */
export function countWindowDays(window: IntelligenceWindow): number {
  const since = Date.parse(`${window.since}T00:00:00Z`);
  const until = Date.parse(`${window.until}T00:00:00Z`);

  return Math.round((until - since) / 86_400_000) + 1;
}

/** Every day in the window, ascending. */
export function listWindowDays(window: IntelligenceWindow): string[] {
  const days: string[] = [];
  const total = countWindowDays(window);
  const start = Date.parse(`${window.since}T00:00:00Z`);

  for (let offset = 0; offset < total; offset += 1) {
    days.push(new Date(start + offset * 86_400_000).toISOString().slice(0, 10));
  }

  return days;
}
