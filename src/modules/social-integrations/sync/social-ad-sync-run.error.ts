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
