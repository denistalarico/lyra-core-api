import type { SocialAdProvider } from '../entities/social-ad-account-connection.entity';
import type { SocialAdReachEntityLevel } from '../entities/social-ad-reach-period.entity';
import { shiftDay } from './insights-window';

/**
 * The periods the daily sync measures without being asked.
 *
 * These six are the ones the dashboard's period picker offers, so pre-measuring
 * them is what makes the common case answerable from the cache with no provider
 * call in the request path. Six requests per account per day against a
 * CPU-metered quota is negligible next to what the insights pass already spends.
 *
 * `today` is in the list even though it is the one row that is always partial
 * and always re-measured — a dashboard opened at 11:00 asking for today would
 * otherwise have nothing to show, and "not measured yet" is a worse answer than
 * "measured an hour ago" when the number exists.
 *
 * Deliberately absent: `yesterday` and any single past day. A one-day period's
 * reach is already correct in `social_ad_metrics_daily` — that is the one grain
 * Meta de-duplicated for us — and `readReach` returns it. Measuring it again
 * would spend a request to learn something already stored.
 */
export type SocialAdReachPresetId =
  | 'today'
  | 'last_7'
  | 'last_30'
  | 'last_90'
  | 'month_current'
  | 'month_previous';

export const SOCIAL_AD_REACH_PRESETS: readonly SocialAdReachPresetId[] = [
  'today',
  'last_7',
  'last_30',
  'last_90',
  'month_current',
  'month_previous',
];

/** An inclusive calendar range in the ad account's own timezone. */
export type SocialAdReachPeriodWindow = {
  since: string;
  until: string;
};

/** A preset resolved against one account's today. */
export type SocialAdReachPresetWindow = SocialAdReachPeriodWindow & {
  preset: SocialAdReachPresetId;
};

/**
 * One preset as a calendar range, relative to the account's own today.
 *
 * `today` is the parameter rather than a clock reading for the same reason it is
 * everywhere else in this module: the day boundary belongs to the ad account's
 * timezone, and a function that read the process clock would resolve
 * "last 7 days" against the server's date — off by one for any account far
 * enough from it, permanently and only near midnight.
 *
 * The rolling windows **include** today, matching what the dashboard's presets
 * mean: "últimos 7 dias" on a page opened today is D-6 through D0, not D-7
 * through D-1. That makes them partial by construction, which is exactly what
 * `isPartialWindow` reports and what the re-measure rule acts on.
 *
 * The month windows are computed on the date parts alone — no instant, no zone
 * conversion — so a month's last day comes from the calendar rather than from
 * arithmetic on milliseconds.
 */
export function resolveReachPreset(
  preset: SocialAdReachPresetId,
  today: string,
): SocialAdReachPeriodWindow {
  switch (preset) {
    case 'today':
      return { since: today, until: today };
    case 'last_7':
      return { since: shiftDay(today, -6), until: today };
    case 'last_30':
      return { since: shiftDay(today, -29), until: today };
    case 'last_90':
      return { since: shiftDay(today, -89), until: today };
    case 'month_current':
      return { since: firstDayOfMonth(today), until: today };
    case 'month_previous': {
      const firstOfThisMonth = firstDayOfMonth(today);
      const lastOfPreviousMonth = shiftDay(firstOfThisMonth, -1);

      return {
        since: firstDayOfMonth(lastOfPreviousMonth),
        until: lastOfPreviousMonth,
      };
    }
  }
}

/** Every preset resolved at once, for one prewarm pass. */
export function resolveReachPresets(
  today: string,
): SocialAdReachPresetWindow[] {
  return SOCIAL_AD_REACH_PRESETS.map((preset) => ({
    preset,
    ...resolveReachPreset(preset, today),
  }));
}

/**
 * The first day of the month a calendar day falls in.
 *
 * Computed on the date text rather than through a `Date`, for the same reason
 * `shiftDay` uses UTC as a bare calendar: the day already belongs to the ad
 * account's timezone, and building an instant to read a month off it is exactly
 * the conversion this module exists to avoid. The month part is already in the
 * string; nothing needs to be derived.
 */
function firstDayOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/**
 * Whether a measured range is still moving.
 *
 * A range whose last day is the account's today — or, defensively, later — was
 * measured over a day that had not finished, so the number it holds is a
 * subtotal that will grow. It is stored, flagged, and re-measured on the next
 * pass.
 *
 * A range entirely in the past is **immutable**, and this is the property that
 * makes the cache worth having at all. Reach is a de-duplicated count over a
 * fixed set of days; once those days are closed, no future delivery changes it.
 * Meta restates *spend* and *conversions* for up to 28 days, but a restatement
 * adds attributed events to days already counted — it does not change who was
 * reached on them. So a closed range is measured exactly once, ever.
 */
export function isPartialReachWindow(
  window: SocialAdReachPeriodWindow,
  today: string,
): boolean {
  return window.until >= today;
}

/**
 * One reach measurement, ready to be written.
 *
 * Carries its own scope, like every other normalized row in this module and for
 * the same reason: the writer then has one complete argument, and there is no
 * second place where a measurement could be stored under the scope of the
 * previous one.
 *
 * `reach` is a digit string, never a number — it is a `bigint` column, and the
 * count of people an account reached over ninety days is not a value to route
 * through an IEEE-754 double on the way in.
 */
export type NormalizedAdReachPeriod = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  connectionId: string;
  provider: SocialAdProvider;
  entityLevel: SocialAdReachEntityLevel;
  entityExternalId: string;
  periodSince: string;
  periodUntil: string;
  accountTimezone: string;
  /**
   * De-duplicated by Meta for **this exact range**, or null when it reported
   * none.
   *
   * Null rather than zero, because the two are different answers: Meta omits
   * `reach` for some requests entirely, and an account that genuinely reached
   * nobody reports `0`. Storing the first as the second would turn a missing
   * measurement into a confident claim.
   */
  reach: string | null;
  /** True when the range reached into a day the account had not finished. */
  isPartial: boolean;
  measuredAt: Date;
};
