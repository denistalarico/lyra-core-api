/**
 * How a series treats a day with no stored fact — see paid's
 * `SocialAdSeriesMode` for the full rationale. `continuous` means every
 * calendar day between `since` and `until` appears exactly once, and a day
 * the read model never observed carries `hasData: false` with null metrics
 * rather than being omitted or zeroed.
 */
export type SocialOrganicSeriesMode = 'continuous';

/**
 * One day of an organic asset's series.
 *
 * Every metric is nullable, and null means *unobserved* rather than zero —
 * a day with `hasData: false` has nulls throughout; a day the sync did read
 * carries real values, which may themselves legitimately be `"0"`.
 */
export type SocialOrganicSeriesPoint = {
  date: string;
  hasData: boolean;

  impressions: string | null;
  /** This day's own de-duplicated reach, as reported — safe here because the grain is one day. */
  reach: string | null;
  followersCount: string | null;
  followersGained: string | null;
  followersLost: string | null;
  profileViews: string | null;

  totalInteractions: string | null;
  likes: string | null;
  comments: string | null;
  shares: string | null;
  saves: string | null;
  replies: string | null;

  /**
   * Distinct accounts that engaged on this day.
   *
   * Returnable per point for the same reason `reach` is: the grain here is one
   * day, which is the grain Meta counted the distinct accounts at. The period
   * total withholds it (`readSingleDayDistinct`) because adding the days would
   * count one account once per day — but that objection does not apply to a
   * series, where each point *is* the day.
   */
  accountsEngaged: string | null;

  /** True while the day is still accumulating; see the sync's `is_partial` flag. */
  isPartial: boolean;
};

/** A day with no stored fact: nulls throughout, never zeros. */
export function emptyOrganicSeriesPoint(
  date: string,
): SocialOrganicSeriesPoint {
  return {
    date,
    hasData: false,
    impressions: null,
    reach: null,
    followersCount: null,
    followersGained: null,
    followersLost: null,
    profileViews: null,
    totalInteractions: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    replies: null,
    accountsEngaged: null,
    isPartial: false,
  };
}

export type SocialOrganicAnalyticsSeriesView = {
  assetId: string;
  timezone: string;
  period: { since: string; until: string };
  seriesMode: SocialOrganicSeriesMode;
  /** Ascending by date, one entry per calendar day in the period. */
  points: SocialOrganicSeriesPoint[];
  /** How many points carry a stored fact — the rest are gaps. */
  observedDays: number;
  hasPartialData: boolean;
};
