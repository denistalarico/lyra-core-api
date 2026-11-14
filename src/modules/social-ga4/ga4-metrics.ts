/**
 * Period arithmetic for GA4 (§7.2): rates are recomputed from sums, never
 * averaged, because `engagementRate` and `averageSessionDuration` are not
 * additive across days.
 */

export type Ga4Sums = {
  sessions: number;
  users: number;
  newUsers: number;
  engagedSessions: number;
  /** Σ(daily average × daily sessions): the period's total engaged seconds. */
  sessionSeconds: number;
  pageViews: number;
  eventCount: number;
  keyEvents: number;
  revenue: number;
};

export type Ga4Totals = Omit<Ga4Sums, 'sessionSeconds'> & {
  /** Σ engaged ÷ Σ sessions, 0..1; null with no sessions. */
  engagementRate: number | null;
  /** Session-weighted mean, in seconds; null with no sessions. */
  avgSessionSeconds: number | null;
};

export const EMPTY_GA4_SUMS: Ga4Sums = {
  sessions: 0,
  users: 0,
  newUsers: 0,
  engagedSessions: 0,
  sessionSeconds: 0,
  pageViews: 0,
  eventCount: 0,
  keyEvents: 0,
  revenue: 0,
};

export function toGa4Totals(sums: Ga4Sums): Ga4Totals {
  const { sessionSeconds, ...rest } = sums;
  return {
    ...rest,
    engagementRate:
      sums.sessions > 0 ? sums.engagedSessions / sums.sessions : null,
    avgSessionSeconds:
      sums.sessions > 0 ? sessionSeconds / sums.sessions : null,
  };
}

export type Ga4Change = { absolute: number; percent: number | null };

/** Null when either side has no reading; percent null from a zero base. */
export function ga4Change(
  current: number | null,
  previous: number | null,
): Ga4Change | null {
  if (current === null || previous === null) return null;
  return {
    absolute: current - previous,
    percent: previous === 0 ? null : ((current - previous) / previous) * 100,
  };
}

export function ga4Changes(current: Ga4Totals, previous: Ga4Totals) {
  const keys = Object.keys(current) as Array<keyof Ga4Totals>;
  return Object.fromEntries(
    keys.map((key) => [key, ga4Change(current[key], previous[key])]),
  ) as Record<keyof Ga4Totals, Ga4Change | null>;
}

export type Ga4Period = {
  since: string;
  until: string;
  days: number;
};

const DAY_MS = 86_400_000;
export const GA4_MAX_PERIOD_DAYS = 366;

/** Validates a closed `[since, until]` span; null when it is not a real one. */
export function parseGa4Period(since: string, until: string): Ga4Period | null {
  const start = Date.parse(`${since}T00:00:00Z`);
  const end = Date.parse(`${until}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  // Rejects 2026-02-31 style dates that Date.parse would roll over.
  if (new Date(start).toISOString().slice(0, 10) !== since) return null;
  if (new Date(end).toISOString().slice(0, 10) !== until) return null;
  const days = Math.round((end - start) / DAY_MS) + 1;
  if (days < 1 || days > GA4_MAX_PERIOD_DAYS) return null;
  return { since, until, days };
}

/** Same length, immediately before. Derived, never caller-supplied. */
export function previousGa4Period(period: Ga4Period): Ga4Period {
  const shift = (day: string, by: number) =>
    new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY_MS)
      .toISOString()
      .slice(0, 10);
  return {
    since: shift(period.since, -period.days),
    until: shift(period.since, -1),
    days: period.days,
  };
}
