import type { SocialAdKpis } from '../analytics/social-ad-kpi';

/**
 * How a series treats a day with no stored fact.
 *
 * `continuous` means every calendar day between `since` and `until` appears
 * exactly once, and a day the read model never observed carries
 * `hasData: false` with null metrics.
 *
 * The alternative — returning only observed days — was rejected because it
 * makes the two states a chart cares about indistinguishable at the client: a
 * gap in the array could mean "no delivery that day" or "never synced", and the
 * chart would connect the line straight across either way. The one thing this
 * contract must never do is emit zeros for an unobserved day, which would draw
 * a confident zero where the truth is "unknown".
 */
export type SocialAdSeriesMode = 'continuous';

/**
 * One day of a series.
 *
 * Every metric is nullable, and null means *unobserved* rather than zero. A day
 * with `hasData: false` has nulls throughout; a day the sync did read carries
 * real values, which may themselves legitimately be `"0"` — an account that ran
 * nothing that day. Collapsing those two into the same representation is the
 * error this shape exists to prevent.
 */
export type SocialAdSeriesPoint = SocialAdSeriesKpis & {
  date: string;

  /**
   * Whether the read model holds a fact for this day.
   *
   * False is not a failure. It is either a day before the account started, a
   * day the backfill has not reached, or a gap — and `GET /freshness` is what
   * distinguishes those.
   */
  hasData: boolean;

  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  linkClicks: string | null;
  leads: string | null;
  conversions: string | null;
  conversionValue: string | null;
  videoViews: string | null;

  /**
   * The day's own de-duplicated reach, as reported.
   *
   * Returnable here — unlike in any period total — precisely because the grain
   * is one day, which is the grain Meta measured it at. This is the only place
   * in the whole analytics surface where a reach figure is a sum of nothing.
   */
  reach: string | null;

  /** True while the day is still accumulating; see the intraday pass. */
  isPartial: boolean;
};

/** KPIs are null on an unobserved day, and independently null on a zero denominator. */
type SocialAdSeriesKpis = {
  [Key in keyof SocialAdKpis]: string | null;
};

export type SocialAdAnalyticsSeriesView = {
  connectionId: string;
  timezone: string;
  currency: string | null;
  period: { since: string; until: string };
  seriesMode: SocialAdSeriesMode;
  /** Ascending by date, one entry per calendar day in the period. */
  points: SocialAdSeriesPoint[];
  /** How many points carry a stored fact — the rest are gaps. */
  observedDays: number;
  hasPartialData: boolean;
};
