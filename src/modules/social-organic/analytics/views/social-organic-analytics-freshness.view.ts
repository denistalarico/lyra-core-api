export type SocialOrganicMetricsFreshness = {
  /** Newest day held, partial or not. */
  latestMetricDate: string | null;
  /** Newest day held that is settled — the newest number safe to report as final. */
  latestClosedMetricDate: string | null;
  /** Newest day still accumulating, if any. */
  latestPartialMetricDate: string | null;
  /** When the newest fact was written, which is how stale the read model is. */
  latestMetricsSyncedAt: string | null;
};

/**
 * Organic's `run_kind` vocabulary is `'manual' | 'scheduled'` — there is no
 * intraday concept in this module, unlike paid's `daily`/`intraday` split.
 * This shape is deliberately not a copy of paid's `SocialAdRunFreshness`.
 */
export type SocialOrganicRunFreshness = {
  latestSuccessfulScheduledRun: string | null;
  latestSuccessfulManualRun: string | null;
};

/**
 * Everything a dashboard needs to answer "is this organic number current?".
 *
 * No `backfill` section: organic analytics has no chunked-backfill planner
 * (unlike paid's `SocialAdBackfillFreshness`), so this omits it rather than
 * fabricating one.
 */
export type SocialOrganicAnalyticsFreshnessView = {
  assetId: string;
  timezone: string;

  metrics: SocialOrganicMetricsFreshness;
  runs: SocialOrganicRunFreshness;

  /** True when the read model holds any provisional day for this asset. */
  hasPartialData: boolean;
};
