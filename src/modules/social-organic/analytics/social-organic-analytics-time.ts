const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How many days one organic analytics read may span.
 *
 * Mirrors paid's `MAX_ANALYTICS_PERIOD_DAYS` in spirit but is deliberately a
 * separate constant in this module: this bounds a local aggregation over
 * `social_organic_*_metrics_daily` rows, unrelated to any provider
 * restatement horizon, and the two modules' limits must be free to diverge
 * without one file's edit silently changing the other's contract.
 */
export const MAX_ORGANIC_ANALYTICS_PERIOD_DAYS = 365;

/** An inclusive calendar range in the asset's own timezone. */
export type SocialOrganicAnalyticsPeriod = {
  since: string;
  until: string;
  /** Inclusive day count: a single-day period is `1`, not `0`. */
  days: number;
};

type CalendarParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** A calendar day in an explicit IANA zone. The host timezone is never read. */
export function calendarDayIn(timezone: string, instant: Date): string {
  const parts = zonedParts(timezone, instant);
  return formatDay(parts.year, parts.month, parts.day);
}

export function calendarHourIn(timezone: string, instant: Date): number {
  return zonedParts(timezone, instant).hour;
}

/** Calendar arithmetic, deliberately independent of the process timezone. */
export function shiftCalendarDay(day: string, amount: number): string {
  const parsed = parseDay(day);
  const shifted = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day + amount),
  );

  return formatDay(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** Inclusive list of days. Refuses malformed or reversed persisted windows. */
export function enumerateCalendarDays(since: string, until: string): string[] {
  parseDay(since);
  parseDay(until);
  if (since > until) throw new Error('invalid_sync_window');

  const days: string[] = [];
  for (let day = since; day <= until; day = shiftCalendarDay(day, 1)) {
    days.push(day);
  }
  return days;
}

/**
 * Validates a requested analytics read range, or refuses it.
 *
 * Deliberately absent: any check against today. An analytics read may name a
 * future date and will simply match no rows, which is the truthful answer —
 * the closed-day rule exists to stop an *ingest* from stamping an open day as
 * final, and a read has nothing to stamp.
 */
export function parseOrganicAnalyticsPeriod(input: {
  since: unknown;
  until: unknown;
}): SocialOrganicAnalyticsPeriod {
  const since = requireDayInput(input.since, 'since');
  const until = requireDayInput(input.until, 'until');

  if (since > until) {
    throw new Error('since must not be after until.');
  }

  const days = enumerateCalendarDays(since, until).length;

  if (days > MAX_ORGANIC_ANALYTICS_PERIOD_DAYS) {
    throw new Error(
      `The period must not exceed ${MAX_ORGANIC_ANALYTICS_PERIOD_DAYS} days.`,
    );
  }

  return { since, until, days };
}

function requireDayInput(value: unknown, field: string): string {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) {
    throw new Error(`${field} must be a date as YYYY-MM-DD.`);
  }
  parseDay(value);
  return value;
}

/**
 * UTC epoch for local midnight in an IANA zone.
 *
 * The short fixed-point conversion uses the runtime timezone database. It is
 * needed because Meta accepts instants while the read model is keyed by the
 * asset's calendar day. A server/UTC midnight would move rows around DST and
 * for every asset outside UTC.
 */
export function localDayStartEpochSeconds(
  day: string,
  timezone: string,
): number {
  const target = parseDay(day);
  const targetAsUtc = Date.UTC(target.year, target.month - 1, target.day);
  let candidate = targetAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = zonedParts(timezone, new Date(candidate));
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const adjustment = targetAsUtc - observedAsUtc;
    candidate += adjustment;
    if (adjustment === 0) break;
  }

  return Math.trunc(candidate / 1000);
}

function parseDay(day: string): { year: number; month: number; day: number } {
  if (!DAY_PATTERN.test(day)) throw new Error('invalid_sync_window');
  const [year, month, date] = day.split('-').map(Number);
  const roundTrip = new Date(Date.UTC(year, month - 1, date));

  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() + 1 !== month ||
    roundTrip.getUTCDate() !== date
  ) {
    throw new Error('invalid_sync_window');
  }

  return { year, month, day: date };
}

function zonedParts(timezone: string, instant: Date): CalendarParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute')),
    second: Number(values.get('second')),
  };
}

function formatDay(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The windows a period-reach measurement is taken for.
 *
 * Exactly the dashboard's resolvable presets — "Hoje", "Esta semana", "Este
 * mês", "Últimos 30 dias" — and no more. `maximum` is deliberately absent: its
 * range moves as history accumulates, so every pass would measure a different
 * window and none of them would be reusable.
 *
 * Custom ranges are not measured. The set of them is unbounded and each is one
 * provider request, so covering them would spend a shared quota on windows
 * nobody opened; the reader reports null for those and the card says the
 * measurement has not been taken.
 *
 * Weeks start on Monday, matching the frontend's `resolveDashboardPeriod`. A
 * mismatch here would store a measurement under a window the dashboard never
 * asks for, so the card would silently stay empty.
 */
export function periodReachWindows(
  today: string,
): ReadonlyArray<{ since: string; until: string }> {
  const date = new Date(`${today}T00:00:00Z`);
  // `getUTCDay()` is 0 for Sunday; shift so Monday is 0.
  const weekdayFromMonday = (date.getUTCDay() + 6) % 7;

  return [
    { since: today, until: today },
    { since: shiftCalendarDay(today, -weekdayFromMonday), until: today },
    { since: `${today.slice(0, 7)}-01`, until: today },
    { since: shiftCalendarDay(today, -29), until: today },
  ];
}
