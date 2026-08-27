/**
 * The sync runtime is switched off.
 *
 * Thrown by the enqueue path, never by the worker. The worker being idle is
 * what "off" means; the endpoint refusing is what keeps "off" from being a
 * silent trap. A queue that accepts work while nothing drains it answers 202 to
 * every request, shows a growing list of `queued` runs that never start, and
 * looks from the outside exactly like a worker that is stuck.
 */
export class SocialAdSyncDisabledError extends Error {
  constructor() {
    super('The Social ad sync runtime is disabled.');
    this.name = 'SocialAdSyncDisabledError';
  }
}

/**
 * A run asks for insights and carries no window.
 *
 * Unreachable through the enqueue path, which derives the kind from whether a
 * window was given. It exists because the worker reads a row, and a row can be
 * older than the code or edited by hand — and the alternative to refusing is
 * guessing a window, which would read and store days nobody asked for.
 *
 * Terminal by classification: no window appears on a retry.
 */
export class SocialAdSyncRunPlanError extends Error {
  constructor(readonly code: 'run_window_missing') {
    super('This run cannot execute the segments it was created with.');
    this.name = 'SocialAdSyncRunPlanError';
  }
}

/**
 * A backfill chain cannot be resumed in the state it is in.
 *
 * Every case is a refusal rather than a silent no-op, because resume is a
 * deliberate act taken in response to a stall, and the four ways it can be
 * inapplicable mean genuinely different things to the person asking:
 *
 * - `backfill_chain_missing` — this connection has never had a backfill. There
 *   is nothing to resume; the scheduler starts one on its own.
 * - `backfill_chain_complete` — every chunk already has a succeeded run.
 * - `backfill_chain_not_stalled` — the first uncovered chunk has never been
 *   attempted, so the chain is simply waiting its turn, and forcing a run here
 *   would jump the queue the scheduler is holding it in.
 * - `backfill_chain_disabled` — the horizon is configured to zero, so the plan
 *   has no chunks to resume.
 */
export class SocialAdBackfillResumeError extends Error {
  constructor(
    readonly code:
      | 'backfill_chain_missing'
      | 'backfill_chain_complete'
      | 'backfill_chain_not_stalled'
      | 'backfill_chain_disabled',
  ) {
    super('This backfill chain cannot be resumed.');
    this.name = 'SocialAdBackfillResumeError';
  }
}
