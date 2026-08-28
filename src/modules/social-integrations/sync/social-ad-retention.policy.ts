import type { SocialAdSyncRunStatus } from '../entities/social-ad-sync-run.entity';

/**
 * How long an operational sync-run log row is kept.
 *
 * ## What retention is for here, and what it is not
 *
 * This policy governs exactly one table: `social_ad_sync_runs`. It removes
 * *operational* state — the record that a routine hourly pass happened and went
 * fine — once nobody can act on it any more. It is explicitly not a data
 * lifecycle for the read model:
 *
 * - `social_ad_metrics_daily` has **no TTL**. The facts are the product. They
 *   feed Analytics comparisons, and they are the substrate a future
 *   Intelligence layer, benchmarking and a client-facing area will read. A
 *   deleted fact cannot be re-fetched either — Meta's own window closes.
 * - `social_ad_entities` is **never** hard-deleted by retention. Disappearance
 *   from the provider is already modelled by `archived_at`, and a campaign row
 *   is what turns an id in the facts into a name on screen. Deleting an
 *   archived campaign would make last quarter's spend anonymous.
 * - `social_ad_account_connections` is not touched. A failed authorization
 *   attempt is a Settings concern with a person attached to it, not a
 *   housekeeping one.
 *
 * ## Why `backfill` is exempt at every status
 *
 * The initial-history sweep stores no flag anywhere. `SocialAdBackfillPlanner`
 * derives *the whole thing* from these rows: whether a chain exists at all,
 * where the plan is anchored, and which chunks are covered. Delete them and a
 * connection whose history was fetched months ago reads as `not_started`, so
 * the next scheduler tick re-fetches ninety days — and a reconnect would do the
 * same. That is the specific outcome this exemption exists to prevent.
 *
 * The exemption covers *every* status, not just `succeeded`. A `failed` or
 * `dead_letter` backfill run is what makes its chunk `stalled`, and stalled is
 * what stops the chain from stepping over a missing week. Removing the failure
 * would not make the chunk covered — it would make it `not_started`, quietly
 * converting a visible stall into an invisible hole in the history.
 *
 * Thirteen rows per connection is what the exemption costs. That is not worth a
 * new watermark column to reclaim.
 *
 * ## Status wins over kind
 *
 * A run that failed is evidence; a run that succeeded is a receipt. So the
 * status rule takes precedence whenever the two disagree: an `intraday` run
 * that dead-lettered is kept for 180 days, not the 30 its kind would suggest.
 * Reversing that would delete the diagnostic trail of a recurring failure at
 * exactly the horizon somebody starts investigating it, while keeping the
 * successes that explain nothing.
 *
 * ## Not a policy for future providers
 *
 * These periods are specific to the current paid-social sync runtime. TikTok
 * Ads, Google Ads, Google Analytics and organic Facebook/Instagram will have
 * their own runtimes with their own cadences and their own read models, and
 * their retention is theirs to state. Nothing here is parameterized by provider
 * on purpose — an abstraction built before a second provider exists would
 * encode a guess about what varies.
 */

/** Kept regardless of age or status. See the note above. */
export const RETENTION_EXEMPT_RUN_KIND = 'backfill';

/**
 * Statuses a retention sweep may never consider.
 *
 * `queued` is future work and `processing` is present work — neither has an
 * age in the sense this policy uses. A long-stuck `processing` row belongs to
 * `SocialAdSyncRunService.recoverStale`, which requeues or dead-letters it
 * according to the attempts it has left. Deleting it here would destroy a run
 * mid-flight and remove the only evidence that the worker died holding it.
 */
export const RETENTION_NEVER_DELETED_STATUSES: readonly SocialAdSyncRunStatus[] =
  ['queued', 'processing'];

/**
 * Days of retention per terminal status, which is the higher-precedence rule.
 *
 * The three failure states share 180 days because they answer the same
 * question — "has this connection been failing, and since when?" — and half a
 * year is long enough to see a seasonal or quota-driven pattern.
 *
 * `cancelled` sits with them rather than with `succeeded`. Nothing in the
 * runtime writes it today: the status is declared on the entity and accepted by
 * the CHECK constraint, but no service produces it, so every `cancelled` row
 * that ever appears will have been made deliberately — by hand, or by a future
 * feature that lets somebody stop a run. A row a human created on purpose is
 * not the kind to discard on the short horizon.
 */
export const RETENTION_DAYS_BY_STATUS: Partial<
  Record<SocialAdSyncRunStatus, number>
> = {
  partial: 180,
  failed: 180,
  dead_letter: 180,
  cancelled: 180,
};

/**
 * Days of retention per run kind, for runs that ended `succeeded`.
 *
 * `intraday` is the short one because it is the noisy one: several passes per
 * account per day, each recording that a day still in progress was re-read.
 * Thirty days keeps a month of cadence — enough to answer "was intraday running
 * last week?" — at a fraction of the rows.
 *
 * The closed-window kinds get 90 days, matching the backfill horizon the rest
 * of this feature is built around: within that window a day can still be
 * re-read and restated, so "which run last wrote this day" is a question with
 * an operational answer. Past it, it is trivia.
 */
export const RETENTION_DAYS_BY_KIND: Record<string, number> = {
  intraday: 30,
  daily: 90,
  manual: 90,
  entities: 90,
};

/**
 * The horizon for a succeeded run of a kind nobody has declared.
 *
 * `run_kind` is an unconstrained `varchar(40)` by design — the vocabulary
 * belongs to the runtime — so a kind added later will reach this policy before
 * anybody remembers to give it a period. 90 days is the conservative choice: it
 * matches the longest of the declared kinds, so an unknown kind is kept at
 * least as long as any known one rather than being swept on the shortest.
 */
export const DEFAULT_RETENTION_DAYS = 90;

export type SocialAdRetentionDecision =
  | { retain: true; reason: RetainReason }
  | { retain: false; days: number; rule: 'status' | 'kind' };

export type RetainReason =
  | 'backfill_exempt'
  | 'not_terminal'
  | 'missing_finished_at'
  | 'within_retention';

export type SocialAdRetentionCandidate = {
  runKind: string;
  status: SocialAdSyncRunStatus;
  /** When the run reached a terminal state. NULL is never deleted. */
  finishedAt: Date | null;
};

/**
 * Whether one run may be deleted, and why not when it may not.
 *
 * Exported and pure so the whole rule set can be asserted without a database,
 * and so the SQL below has something to be checked against: the sweep and this
 * function must agree, and a test that runs both over the same fixtures is what
 * keeps them from drifting.
 *
 * ## Why `finished_at` and nothing else
 *
 * Age is measured from terminalization, never from creation. A run can sit
 * `queued` for hours behind a backfill chain and be claimed long after it was
 * made, so `created_at` measures when somebody *asked*, which is not when the
 * row became history. Using it would delete the log of a run that finished
 * yesterday because it was enqueued in March.
 *
 * ## Fail closed on a missing timestamp
 *
 * A terminal row with a NULL `finished_at` is kept, forever if necessary. It
 * can happen: `recoverStale` deliberately leaves `finished_at` NULL when it
 * requeues, and a row written before the current lifecycle existed may have no
 * timestamp at all. There is no way to date such a row, and the choice is
 * between keeping something possibly stale and deleting something possibly
 * recent. Retention exists to reclaim space that has no value, so the cost of
 * keeping is bounded and the cost of guessing is not.
 */
export function decideRetention(
  candidate: SocialAdRetentionCandidate,
  now: Date,
): SocialAdRetentionDecision {
  if (candidate.runKind === RETENTION_EXEMPT_RUN_KIND) {
    return { retain: true, reason: 'backfill_exempt' };
  }

  if (RETENTION_NEVER_DELETED_STATUSES.includes(candidate.status)) {
    return { retain: true, reason: 'not_terminal' };
  }

  if (!candidate.finishedAt) {
    return { retain: true, reason: 'missing_finished_at' };
  }

  const days = retentionDaysFor(candidate.runKind, candidate.status);
  const ageDays =
    (now.getTime() - candidate.finishedAt.getTime()) / 86_400_000;

  // Strictly greater: a run finished exactly `days` ago is still inside its
  // window. The boundary has to fall somewhere, and keeping one extra day is
  // the harmless direction.
  if (ageDays <= days) {
    return { retain: true, reason: 'within_retention' };
  }

  return {
    retain: false,
    days,
    rule: RETENTION_DAYS_BY_STATUS[candidate.status] ? 'status' : 'kind',
  };
}

/**
 * The period that governs a terminal run, status first.
 *
 * The one line that encodes the precedence rule. A status with its own period —
 * the failure states and `cancelled` — overrides its kind entirely, so
 * `intraday` + `dead_letter` resolves to 180 days rather than 30.
 */
export function retentionDaysFor(
  runKind: string,
  status: SocialAdSyncRunStatus,
): number {
  return (
    RETENTION_DAYS_BY_STATUS[status] ??
    RETENTION_DAYS_BY_KIND[runKind] ??
    DEFAULT_RETENTION_DAYS
  );
}

/** The longest period any rule can produce, for logging and for tests. */
export const MAX_RETENTION_DAYS = Math.max(
  ...Object.values(RETENTION_DAYS_BY_STATUS).filter(
    (value): value is number => value !== undefined,
  ),
  ...Object.values(RETENTION_DAYS_BY_KIND),
  DEFAULT_RETENTION_DAYS,
);
