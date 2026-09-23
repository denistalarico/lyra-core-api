/**
 * Which grain the returned `reach` was measured at.
 *
 * Reach is de-duplicated audience, so it is the one metric that cannot be
 * summed — see `social_organic_account_metrics_daily`'s entity docblock.
 * `daily` means "the stored per-day figures, which you may not add"; this
 * mirrors `SocialAdReachGranularity` in the paid module exactly, for the same
 * reason.
 */
export type SocialOrganicReachGranularity = 'daily';

/**
 * The additive totals of one period for one organic asset.
 *
 * Narrower than paid's `SocialAdAnalyticsTotals` on purpose: the account
 * table has no spend, click or conversion counters, and no engagement-rate
 * inputs (likes/comments/shares/saves live only at post grain, which this
 * first pass of A3 does not read — see the read service's docblock on the
 * deferred `posts()` follow-up). Every numeric field is a decimal *string*,
 * matching every other analytics surface in this codebase: the underlying
 * columns are `bigint`, which exceeds what an IEEE-754 double represents
 * exactly above 2^53.
 */
export type SocialOrganicAnalyticsTotals = {
  impressions: string;

  /** Null unless the period is exactly one day and that day reported it. */
  reach: string | null;
  reachGranularity: SocialOrganicReachGranularity;

  /**
   * STOCK, not flow — the latest observed value inside the period, never a
   * sum. Null when the period has no observation at all.
   */
  followersCount: string | null;

  /** Daily flow; safe to sum across the period. */
  followersGained: string;
  /** Daily flow; safe to sum across the period. */
  followersLost: string;

  profileViews: string;

  /**
   * Account-level engagement flows, safe to sum across the period.
   *
   * `likes`/`comments`/`shares`/`saves` here are the ACCOUNT's totals for the
   * day, which is not the same as the sum of its posts': a like on a post
   * published last year counts on the day it happened, and the post grain would
   * never attribute it to this period.
   */
  totalInteractions: string;
  likes: string;
  comments: string;
  shares: string;
  saves: string;
  replies: string;

  /**
   * Distinct accounts that engaged — null unless the period is exactly one day.
   *
   * Same rule as `reach`, for the same reason: Meta measures it per day, and no
   * sum of daily distinct counts is the distinct count of the period.
   */
  accountsEngaged: string | null;
};

export type SocialOrganicAnalyticsPeriodView = {
  since: string;
  until: string;
};

/**
 * The overview response for one organic asset.
 *
 * Built field by field from aggregates, never by spreading a row — nothing
 * here carries a scope column, a stored token, or a `sync_run_id`.
 */
export type SocialOrganicAnalyticsOverviewView = {
  assetId: string;
  /** The zone whose calendar days the period was measured in. */
  timezone: string;

  period: SocialOrganicAnalyticsPeriodView;
  totals: SocialOrganicAnalyticsTotals;

  /**
   * Whether any day inside the period is still provisional (`is_partial`).
   * Scoped to this period only, matching paid's `hasPartialData`.
   */
  hasPartialData: boolean;

  /**
   * The most recent day the read model holds for this asset, anywhere — not
   * just inside the period. Null when the asset has no facts at all.
   */
  lastFactDate: string | null;
};
