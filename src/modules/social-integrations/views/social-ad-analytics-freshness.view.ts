import type { SocialAdBackfillChunkState } from '../services/social-ad-backfill-planner.service';

/**
 * The backfill chain as a whole, derived from the run log alone.
 *
 * The four values are a fold of the per-chunk states S2.6 already defines, and
 * the mapping is deliberately one-directional — this view reads
 * `resolveChunkState` and never re-decides what a chunk means. A second
 * definition of "covered" living in a read endpoint would drift from the one the
 * planner enforces, and the dashboard would then disagree with the queue about
 * whether a client has ninety days of history.
 *
 * - `not_started` — no `backfill` run exists. The connection has never had its
 *   initial backfill proven, whatever facts it holds.
 * - `in_progress` — the chain exists and its first uncovered chunk is either
 *   in flight or not yet attempted.
 * - `stalled` — the first uncovered chunk has settled without ever succeeding.
 *   The chain will not move again on its own; the resume endpoint exists for it.
 * - `complete` — every chunk of the anchored plan has a succeeded run.
 */
export type SocialAdBackfillChainStatus =
  | 'not_started'
  | 'in_progress'
  | 'stalled'
  | 'complete';

export type SocialAdBackfillFreshness = {
  status: SocialAdBackfillChainStatus;

  /**
   * The day the chain's plan is anchored to, or null before a chain exists.
   *
   * Read from the newest `window_end` among the connection's own backfill runs
   * — the same source the planner uses — and never recomputed from today. A
   * chain begun fifteen days ago still reports the anchor it started with, which
   * is what makes this figure comparable with the chunk boundaries the queue is
   * actually working through.
   */
  anchor: string | null;

  chunksTotal: number;
  chunksSucceeded: number;
  chunksInFlight: number;

  /** Convenience flags over `status`, for a UI that renders a badge. */
  stalled: boolean;
  complete: boolean;
};

export type SocialAdMetricsFreshness = {
  /** Newest day held, partial or not. */
  latestMetricDate: string | null;
  /** Newest day held that is settled — the newest number safe to report as final. */
  latestClosedMetricDate: string | null;
  /** Newest day still accumulating, if any. */
  latestPartialMetricDate: string | null;
  /** When the newest fact was written, which is how stale the read model is. */
  latestMetricsSyncedAt: string | null;
};

export type SocialAdRunFreshness = {
  latestSuccessfulDailyRun: string | null;
  latestSuccessfulIntradayRun: string | null;
};

/**
 * Everything a dashboard needs to answer "is this number current?".
 *
 * Built entirely from local tables. Notably it does *not* ask the provider
 * whether a sync is healthy — health as seen from here is a property of what
 * landed in the read model, and a Graph call would make a status widget fail for
 * the same reasons a sync fails.
 */
export type SocialAdAnalyticsFreshnessView = {
  connectionId: string;
  timezone: string;

  /**
   * The connection's own status, reported rather than enforced.
   *
   * A `disconnected` connection still answers this endpoint with its full
   * history — that is the point of surfacing the status as data instead of as a
   * 404.
   */
  connectionStatus: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;

  metrics: SocialAdMetricsFreshness;
  runs: SocialAdRunFreshness;
  backfill: SocialAdBackfillFreshness;

  /** True when the read model holds any provisional day for this connection. */
  hasPartialData: boolean;
};

/** Folds the planner's per-chunk states into the chain-level status. */
export function toBackfillChainStatus(input: {
  hasChain: boolean;
  firstUncovered: SocialAdBackfillChunkState | null;
}): SocialAdBackfillChainStatus {
  if (!input.hasChain) return 'not_started';
  if (input.firstUncovered === null) return 'complete';

  return input.firstUncovered === 'stalled' ? 'stalled' : 'in_progress';
}
