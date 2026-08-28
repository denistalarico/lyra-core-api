import type { SocialAdChange, SocialAdKpis } from '../analytics/social-ad-kpi';

/**
 * Which grain the returned `reach` was measured at.
 *
 * Reach is de-duplicated people, so it is the one metric that cannot be summed:
 * anybody who saw an ad on Monday and again on Tuesday is one person and two
 * daily rows. Adding them double-counts, and there is no local arithmetic that
 * undoes it — the de-duplication happened inside Meta, over identities this
 * system never sees.
 *
 * So the overview does not sum it, and this field says so out loud rather than
 * letting a caller assume. `daily` means "the stored per-day figures, which you
 * may not add"; a future `period` would mean a genuine period-level reach
 * fetched as its own measurement. Returning a number with no grain attached is
 * how a dashboard ends up displaying the sum.
 */
export type SocialAdReachGranularity = 'daily';

/**
 * The additive totals of one period, plus the KPIs derived from them.
 *
 * Every numeric field is a decimal *string*, not a number. The columns behind
 * them are `numeric(18,6)` and `bigint`, both of which exceed what an IEEE-754
 * double represents exactly — a quarter of ad spend serialized through a JS
 * number comes back having drifted, and the count columns lose precision above
 * 2^53 outright. The string is what Postgres stores and what the client should
 * parse with its own decimal type.
 */
export type SocialAdAnalyticsTotals = SocialAdKpis & {
  spend: string;
  impressions: string;
  clicks: string;
  linkClicks: string;
  leads: string;
  conversions: string;
  conversionValue: string;
  videoViews: string;

  /**
   * Null unless every contributing day reported it, and never a sum.
   *
   * Meta omits reach for some breakdowns entirely, and a `0` for "not reported"
   * is indistinguishable from a genuine zero-reach period.
   */
  reach: string | null;
  reachGranularity: SocialAdReachGranularity;
};

/** Period-over-period movement, one entry per additive metric. */
export type SocialAdAnalyticsChange = {
  spend: SocialAdChange;
  impressions: SocialAdChange;
  clicks: SocialAdChange;
  linkClicks: SocialAdChange;
  leads: SocialAdChange;
  conversions: SocialAdChange;
  conversionValue: SocialAdChange;
  videoViews: SocialAdChange;
};

export type SocialAdAnalyticsPeriodView = {
  since: string;
  until: string;
};

/**
 * The overview response.
 *
 * Built field by field from aggregates, never by spreading a row. Nothing here
 * carries a scope column, a connection credential, a provider payload or a
 * `sync_run_id`: the caller supplied the scope and must not be handed it back as
 * if it were data, and the rest is internal.
 */
export type SocialAdAnalyticsOverviewView = {
  connectionId: string;
  /** The zone whose calendar days the period was measured in. */
  timezone: string;
  /** Null when no contributing row carried one — an account with no spend. */
  currency: string | null;

  period: SocialAdAnalyticsPeriodView;
  comparisonPeriod: SocialAdAnalyticsPeriodView;

  current: SocialAdAnalyticsTotals;
  previous: SocialAdAnalyticsTotals;
  change: SocialAdAnalyticsChange;

  /**
   * Whether any day inside the *current* period is still provisional.
   *
   * True when at least one contributing fact carries `is_partial`, which today
   * means the intraday pass wrote it for a day the account has not finished. It
   * is the flag that lets a report say "today, so far" instead of presenting an
   * accumulating total as final — and the reason a dashboard should not cache
   * this response past the account's midnight.
   *
   * Scoped to the current period on purpose: the comparison window is historical
   * and its partiality, if any, is a sync problem rather than a property of the
   * number being shown.
   */
  hasPartialData: boolean;

  /**
   * The most recent day the read model actually holds for this connection,
   * anywhere — not just inside the period.
   *
   * The answer to "why does this look low?", which is nearly always "the sync is
   * behind", not "spend fell". Null when the connection has no facts at all.
   */
  lastFactDate: string | null;
};
