import { Injectable, Logger } from '@nestjs/common';
import { currentDayIn, shiftDay } from '../sync/insights-window';
import {
  planBackfillChunks,
  type SocialAdBackfillChunk,
} from '../sync/social-ad-backfill-plan';
import {
  INSIGHTS_ENTITY_LEVELS,
  SYNC_ENTITY_LEVELS,
  buildSyncIdempotencyKey,
  coversInsightsLevels,
  type SocialAdSyncRunKind,
} from '../sync/social-ad-sync-run.contract';
import type { SocialAdSchedulableConnection } from './social-ad-connection.service';
import { SocialAdSyncConfigService } from './social-ad-sync-config.service';
import {
  SocialAdSyncRunService,
  type SocialAdBackfillChunkOutcome,
} from './social-ad-sync-run.service';

/**
 * The kinds that hold the chain back while they are in flight.
 *
 * `backfill` for fairness — one chunk at a time — and `entities` because the
 * hierarchy sweep is the chain's first step and the chunks wait for it.
 */
const CHAIN_BLOCKING_KINDS: readonly SocialAdSyncRunKind[] = [
  'entities',
  'backfill',
];

/**
 * Whether the settling of a run of this kind should move the chain along.
 *
 * The same two kinds, read from the other end. A chain that only advanced on
 * the scheduler's hourly tick would take thirteen hours to fetch a quarter of
 * history; advancing when the previous piece finishes makes it thirteen ticks
 * of the worker instead, which is under a minute. The hourly tick stays as the
 * recovery path for a chain whose last run died before it could hand over.
 *
 * `entities` is included because it is the chain's first step. A user's own
 * hierarchy sync settling will also call the planner, which is harmless: the
 * planner's answer for a connection that needs nothing is `skipped`, and for
 * one that needs a backfill it is the same run the next tick would have made.
 */
export function advancesBackfillChain(runKind: string): boolean {
  return (CHAIN_BLOCKING_KINDS as readonly string[]).includes(runKind);
}

/**
 * What the run log says about one chunk of a plan.
 *
 * Derived per window from every `backfill` run that ever targeted it, because a
 * window can be attempted more than once: the resume endpoint exists precisely
 * to try a stalled one again, and an old failure must not outvote a later
 * success.
 *
 * The order below is the precedence, and it is not arbitrary:
 *
 * - `covered` first. *Any* succeeded run **that read every level we now ingest**
 *   settles the window forever — that is what makes a retry able to unstick a
 *   chain.
 * - `in_flight` next, so a resumed chunk reads as busy rather than as the
 *   failure it is being retried for.
 * - `stalled` only when every attempt has settled without succeeding.
 * - `not_started` when the log has nothing for this window at all — **or when
 *   everything it has succeeded at a narrower set of levels.**
 *
 * That last clause is I3.4's whole migration story, and it is worth stating
 * plainly. A chunk whose only run succeeded under `["account","campaign"]` is
 * `not_started`, not `stalled`: nothing about it failed, and nothing about it
 * needs an operator. It simply has not been asked the question the plan now
 * asks, so the chain enqueues it exactly as it would a window nobody had ever
 * requested. Calling it `stalled` instead would be worse in the way that
 * matters — the chain would refuse to move and would wait for a human to resume
 * thirteen windows by hand.
 */
export type SocialAdBackfillChunkState =
  | 'covered'
  | 'in_flight'
  | 'stalled'
  | 'not_started';

/** What one planning call decided, for the log and for tests. */
export type SocialAdBackfillDecision =
  | { action: 'enqueued'; runKind: 'entities' | 'backfill'; runId: string }
  | {
      action: 'skipped';
      reason:
        | 'sync_disabled'
        | 'backfill_disabled'
        | 'chain_busy'
        | 'chain_stalled'
        | 'complete';
    };

/**
 * Folds every run that targeted a window into that window's single state.
 *
 * Exported because the planner and the resume endpoint must agree on it to the
 * letter: the endpoint refuses to resume anything the planner would not call
 * `stalled`, and two copies of this precedence would drift into a resume that
 * duplicates work or one that refuses a chunk genuinely stuck.
 */
export function resolveChunkState(
  outcomes: readonly SocialAdBackfillChunkOutcome[],
): SocialAdBackfillChunkState {
  if (!outcomes.length) return 'not_started';

  // Both halves, and in this order. A succeeded run that read a narrower set of
  // levels than we now ingest did its job completely — it is simply not an
  // answer to the question being asked.
  if (
    outcomes.some(
      (outcome) =>
        outcome.status === 'succeeded' &&
        coversInsightsLevels(outcome.entityLevels),
    )
  ) {
    return 'covered';
  }

  if (outcomes.some((outcome) => IN_FLIGHT_STATUSES.includes(outcome.status))) {
    return 'in_flight';
  }

  /**
   * Everything settled, nothing covered. Which of the two reasons is it?
   *
   * A window whose attempts *failed* is stalled: something went wrong, retries
   * are spent, and an operator has to decide. A window that only ever succeeded
   * at a narrower level set has nothing wrong with it — it predates the level —
   * so it reads as `not_started` and the chain fetches it on its own.
   *
   * Mixing the two would be a real regression in both directions: a genuinely
   * dead-lettered week would quietly re-enqueue forever, or an entire existing
   * connection would need thirteen manual resumes to gain ad-set history.
   */
  const everySettledRunSucceeded = outcomes.every(
    (outcome) => outcome.status === 'succeeded',
  );

  return everySettledRunSucceeded ? 'not_started' : 'stalled';
}

const IN_FLIGHT_STATUSES: readonly string[] = ['queued', 'processing'];

/** Every run that targeted each window, keyed by the day the window ends on. */
export function groupOutcomesByWindow(
  outcomes: readonly SocialAdBackfillChunkOutcome[],
): Map<string, SocialAdBackfillChunkOutcome[]> {
  const grouped = new Map<string, SocialAdBackfillChunkOutcome[]>();

  for (const outcome of outcomes) {
    const bucket = grouped.get(outcome.until);

    if (bucket) bucket.push(outcome);
    else grouped.set(outcome.until, [outcome]);
  }

  return grouped;
}

/**
 * Decides, one piece at a time, how a connection gets its history.
 *
 * ## Why a chain and not a job
 *
 * Ninety days of campaign-level insights is thirteen provider reads that must
 * not run as one. A single run holding the worker for thirteen consecutive
 * reads would park every other account's morning behind it — the worker claims
 * one run per tick, by design, because two concurrent walks of one provider
 * spend a shared quota racing each other. So the ninety days are thirteen runs,
 * and this class is what turns "this connection needs history" into exactly one
 * of them at a time.
 *
 * Each chunk therefore re-enters the queue at the back when the previous one
 * settles. That is the whole fairness story, and it needs no priority column:
 * a `manual` run enqueued while a backfill is going was queued *earlier* than
 * the chunk that follows the one in flight, and the claim query orders by
 * `available_at, created_at`. A person clicking "sync now" waits for one chunk,
 * never for thirteen.
 *
 * ## Why the state is derived and not stored
 *
 * There is no `backfill_completed_at` on the connection, and there is no flag
 * anywhere. Everything this class needs to know is already recorded by the runs
 * it created: which chunks have been attempted, where the plan is anchored, and
 * whether one is in flight. A flag would be a second copy of that, and the two
 * would disagree the first time a run was retried, cancelled, or created by
 * hand.
 *
 * ## Only sync history certifies coverage
 *
 * The one question that decides whether a connection gets a chain is:
 *
 * > does this connection have any `backfill` run at all?
 *
 * Not "does it have facts". Facts prove that metrics exist for the days they
 * cover; they cannot prove that a *window was read*. An account with facts for
 * eighty of ninety days may be missing the other ten because nobody ever asked
 * for them — and, worse, the ten missing days are indistinguishable from ten
 * days the account did not deliver, because Meta returns nothing for both. No
 * threshold over `social_ad_metrics_daily` can tell those apart, so no
 * threshold over it is evidence, and an earlier version of this planner that
 * used one has been removed rather than tuned.
 *
 * A run log entry is different in kind: it records that a window was requested
 * and how that request ended. That is the only durable proof this feature has,
 * so it is the only thing consulted.
 *
 * ## `backfill complete`, defined once
 *
 * A connection's backfill is complete when, for the plan anchored at the newest
 * window end among its own backfill runs:
 *
 * > every chunk in that plan has at least one `backfill` run that ended
 * > `succeeded` **and recorded every insights level currently ingested**.
 *
 * The second clause arrived with I3.4, and it is the reason a connection that
 * was certified 13/13 before ad-set insights existed is not silently treated as
 * holding ad-set history it never fetched. Coverage is a claim about *what was
 * read*, so widening what we read necessarily narrows what an old run certifies.
 * See `coversInsightsLevels` and `INSIGHTS_ENTITY_LEVELS`.
 *
 * Nothing weaker counts. A chunk whose every attempt ended `partial`, `failed`,
 * `dead_letter` or `cancelled` fetched some or none of its week, so a plan
 * containing one is *incomplete*, and the chain **stops there** rather than
 * stepping over it. An incomplete chain never becomes complete by attrition.
 *
 * That is a deliberate reversal of this planner's first design, which counted a
 * chunk as done once it had been *attempted*. Skipping past a dead-lettered
 * week does keep the queue quiet, but it produces the one outcome this feature
 * exists to prevent: a connection that reports ninety days of history with a
 * silent hole in week nine. Stalling is visible; a hole is not.
 *
 * A stall is not permanent, but it is not cleared by accident either: only
 * another `backfill` run of that same window can clear it, which is what
 * `SocialAdBackfillResumeService` exists to create. A `manual` sync covering
 * the same days writes the same facts and deliberately does *not* advance the
 * chain — otherwise "complete" would once again mean "some facts are present",
 * which is the claim this design rejects.
 *
 * The full rule, stated once:
 *
 * - **No backfill runs at all** → a chain starts. That is the only condition
 *   that starts one, whatever facts the connection already holds.
 * - **Backfill runs exist** → continue the existing plan from its own anchor,
 *   which never moves, so a finished plan cannot renew itself. A plan whose
 *   chunks succeeded at a narrower level set is *not* finished: those windows
 *   read as `not_started` and the chain re-fetches them, one at a time, at the
 *   same boundaries, writing the levels that were missing. It renews once per
 *   widening of `INSIGHTS_ENTITY_LEVELS` and never on its own.
 * - **The first uncovered chunk is `stalled`** → stop and report
 *   `chain_stalled`. No new work while a week is unaccounted for, and no
 *   automatic re-attempt of a window that has already exhausted its retries.
 * - **Reconnecting changes nothing.** Both authorization flows promote the
 *   existing connection row rather than inserting a new one, so the runs are
 *   still there under the same `connection_id`, and the answer to "does this
 *   need history?" is the same as it was a minute earlier. A complete chain is
 *   not redone; an incomplete one is continued, never duplicated — the anchor
 *   comes from the existing runs, so a reconnect resumes the same plan rather
 *   than starting a parallel one. Nothing here reads `connectedAt`.
 */
@Injectable()
export class SocialAdBackfillPlannerService {
  private readonly logger = new Logger(SocialAdBackfillPlannerService.name);

  constructor(
    private readonly config: SocialAdSyncConfigService,
    private readonly runService: SocialAdSyncRunService,
  ) {}

  /**
   * Enqueues at most one piece of this connection's backfill.
   *
   * Idempotent and safe to call from anywhere, which is why it is called from
   * three places that would otherwise each need their own version of this
   * decision: the moment an account is selected, every scheduler tick, and the
   * settling of a backfill run.
   *
   * Returns what it decided rather than a boolean. "Nothing to do" has five
   * distinct meanings here — off, off for backfill, busy, already has history,
   * finished — and collapsing them would make the one question anybody asks
   * about this feature ("why did my new connection not backfill?")
   * unanswerable.
   */
  async planNext(
    connection: SocialAdSchedulableConnection,
    now: Date = new Date(),
  ): Promise<SocialAdBackfillDecision> {
    /**
     * The kill switch, first and without exception.
     *
     * Nothing is enqueued while the runtime is off, because a queue nothing
     * drains is worse than an empty one: the backlog would sit there looking
     * like a wedged worker, and would then execute all at once — every
     * connection's whole history — the moment somebody restarted the API with
     * the switch back on.
     *
     * Nothing is lost by refusing. The decision is derived from state that does
     * not expire, so the first scheduler tick after the runtime comes back asks
     * this same question and gets a different answer. A connection made during
     * the outage is backfilled within the hour of the switch being turned on,
     * with no operator action and no record that it was ever postponed.
     */
    if (!this.config.enabled) {
      return { action: 'skipped', reason: 'sync_disabled' };
    }

    const totalDays = this.config.backfillDays;

    if (totalDays <= 0) {
      return { action: 'skipped', reason: 'backfill_disabled' };
    }

    // Before any other read: a chain with work in flight has already answered
    // this question, and the cheapest way to honour "one chunk at a time" is
    // not to compute the plan at all.
    if (
      await this.runService.hasInFlightRun(
        connection.connectionId,
        CHAIN_BLOCKING_KINDS,
      )
    ) {
      return { action: 'skipped', reason: 'chain_busy' };
    }

    const outcomes = await this.runService.listBackfillChunkOutcomes(
      connection.connectionId,
    );

    /**
     * Where the plan begins, and it is deliberately not "today".
     *
     * A chain that already exists is anchored to the newest window it ever
     * produced — the first chunk — so the boundaries of chunks 1 through 12 are
     * the same today as they were the day the chain started. Re-deriving the
     * anchor from the current date would slide every remaining boundary by a
     * day for each day the chain takes, leaving days that belong to no chunk.
     *
     * Every status feeds the anchor, failures included: the anchor records
     * where the plan *started*, which does not change because a week later
     * failed. Only coverage cares how a chunk ended.
     *
     * Every *level set* feeds it too, and that is what makes I3.4's ad-set
     * sweep land on the same thirteen windows as the original chain rather than
     * on thirteen new ones cut from today. The runs that covered only account
     * and campaign still anchor the plan; they merely no longer certify it. Had
     * the anchor been filtered to fully-covering runs, a connection whose old
     * chunks all predate ad set would have found no anchor at all, re-anchored
     * at yesterday, and written a second, offset set of windows overlapping the
     * first — the exact sliding-plan failure `planBackfillChunks` exists to
     * prevent, and it would have been invisible because every day would still
     * have had facts.
     *
     * A chain that does not exist yet anchors at the account's last settled
     * day, which is the newest day a closed window may legally cover.
     */
    const anchor =
      outcomes[0]?.until ??
      shiftDay(currentDayIn(connection.timezone, now), -1);

    const chunks = planBackfillChunks({
      anchor,
      totalDays,
      chunkDays: this.config.backfillChunkDays,
    });

    if (chunks.length === 0) {
      return { action: 'skipped', reason: 'backfill_disabled' };
    }

    const byWindow = groupOutcomesByWindow(outcomes);

    const next = chunks.find(
      (chunk) =>
        resolveChunkState(byWindow.get(chunk.until) ?? []) !== 'covered',
    );

    // Every chunk in the plan has a succeeded run. Complete, and because the
    // anchor comes from the runs themselves, it stays complete.
    if (!next) return { action: 'skipped', reason: 'complete' };

    const state = resolveChunkState(byWindow.get(next.until) ?? []);

    /**
     * The chunk is outstanding — but was it *tried*?
     *
     * A window whose attempts have all settled without succeeding is stalled,
     * and the chain waits rather than stepping over it. Enqueueing it again
     * here would also be pointless: the in-flight index would not stop it
     * (those runs have settled), so the planner would produce a fresh attempt
     * on every tick, hourly, forever, for a window that has already exhausted
     * the retry policy that exists for exactly this. Clearing it is a
     * deliberate act — see `SocialAdBackfillResumeService`.
     *
     * `in_flight` lands here too. It is reachable despite the `hasInFlightRun`
     * gate above, because a resumed chunk is queued behind chunks that come
     * *after* it in the plan; either way there is nothing to enqueue.
     */
    if (state !== 'not_started') {
      this.log('chain stalled', {
        connectionId: connection.connectionId,
        chunk: next.index,
        since: next.since,
        until: next.until,
        state,
      });

      return { action: 'skipped', reason: 'chain_stalled' };
    }

    /**
     * Starting a chain. There is no second condition to check.
     *
     * Note what is *not* consulted here: the facts. Whether this connection
     * already holds ninety days of metrics is not evidence that ninety days
     * were ever requested, and the run log — empty, at this point — is the only
     * thing that certifies coverage.
     */
    if (outcomes.length === 0) {
      /**
       * The hierarchy, once, before any history is read.
       *
       * Its own run rather than a segment inside the first chunk: `entities` is
       * an existing kind that does exactly this, so the chain reuses it instead
       * of describing a hierarchy sweep a second way. It also gets its own row
       * — its own retry, its own failure code, its own line in the list a
       * person reads — which a segment buried in a twelve-week chunk would not.
       * The chunks themselves carry no hierarchy segment at all, so the tree is
       * read once for the whole backfill rather than thirteen times.
       *
       * Skipped when a hierarchy run has already settled for this connection,
       * which is the normal case for an account somebody has already synced by
       * hand. A settled run that *failed* also counts: the mirror is not a
       * precondition for storing facts — `social_ad_metrics_daily` has no
       * foreign key to it, precisely so a campaign created since the last sweep
       * still gets its spend recorded — and stalling ninety days of history
       * behind a hierarchy failure would trade a cosmetic gap for a real one.
       */
      const hierarchy = await this.enqueueHierarchy(connection);

      if (hierarchy) return hierarchy;
    }

    return this.enqueueChunk(connection, next);
  }

  /**
   * The connect-time entry point, shared by both authorization flows.
   *
   * Called after an ad account has actually been bound — not from the OAuth
   * callback, which is several steps earlier. At callback time the row has a
   * token and no account, no currency and no timezone; a backfill planned there
   * would have no window to compute and no account to read, and would fail
   * against a connection the person is still in the middle of making.
   *
   * The three conditions below are exactly what `listSchedulable` requires, and
   * they are re-stated rather than assumed because this path does not go
   * through that query. A row that fails any of them is not an error here: the
   * connection is simply not ready, and the hourly tick will find it when it is.
   *
   * Never throws. Backfilling is a consequence of connecting an account, not
   * part of it — a planner that failed must not turn a successful
   * authorization into an error message in front of the person who just
   * completed it. The same is true of the kill switch: with the runtime off
   * this does nothing at all, the connection is made normally, and the first
   * tick after the runtime returns starts the history.
   */
  async planForConnectedAccount(connection: {
    id: string;
    tenantId: string;
    workspaceId: string;
    agencyClientId: string | null;
    provider: string;
    connectionStatus: string;
    externalAccountId: string | null;
    timezone: string | null;
  }): Promise<void> {
    if (
      connection.connectionStatus !== 'connected' ||
      !connection.externalAccountId ||
      !connection.timezone
    ) {
      return;
    }

    try {
      await this.planNext({
        connectionId: connection.id,
        tenantId: connection.tenantId,
        workspaceId: connection.workspaceId,
        agencyClientId: connection.agencyClientId,
        provider: connection.provider,
        timezone: connection.timezone,
      });
    } catch (error) {
      this.logger.error(
        `Social ad backfill planning failed for ${connection.id}: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }
  }

  private async enqueueHierarchy(
    connection: SocialAdSchedulableConnection,
  ): Promise<SocialAdBackfillDecision | null> {
    const idempotencyKey = buildSyncIdempotencyKey({
      connectionId: connection.connectionId,
      runKind: 'entities',
      windowStart: null,
      windowEnd: null,
      entityLevels: SYNC_ENTITY_LEVELS,
    });

    if (
      await this.runService.hasSettledRun(
        connection.connectionId,
        idempotencyKey,
      )
    ) {
      return null;
    }

    const result = await this.runService.enqueue({
      tenantId: connection.tenantId,
      workspaceId: connection.workspaceId,
      agencyClientId: connection.agencyClientId,
      connectionId: connection.connectionId,
      provider: connection.provider,
      runKind: 'entities',
      windowStart: null,
      windowEnd: null,
      requestedById: null,
    });

    this.log('hierarchy queued', {
      connectionId: connection.connectionId,
      runId: result.run.id,
      deduplicated: result.deduplicated,
    });

    return {
      action: 'enqueued',
      runKind: 'entities',
      runId: result.run.id,
    };
  }

  private async enqueueChunk(
    connection: SocialAdSchedulableConnection,
    chunk: SocialAdBackfillChunk,
  ): Promise<SocialAdBackfillDecision> {
    const result = await this.runService.enqueue({
      tenantId: connection.tenantId,
      workspaceId: connection.workspaceId,
      agencyClientId: connection.agencyClientId,
      connectionId: connection.connectionId,
      provider: connection.provider,
      runKind: 'backfill',
      windowStart: chunk.since,
      windowEnd: chunk.until,
      // Insights only. The hierarchy is the chain's first step and is not
      // repeated per chunk, so claiming all four levels would describe work
      // this run does not do.
      entityLevels: INSIGHTS_ENTITY_LEVELS,
      // Nobody asked for it. A backfill is a consequence of connecting an
      // account, not a request, and `requested_by_id` is what separates the two
      // in the history.
      requestedById: null,
    });

    this.log('chunk queued', {
      connectionId: connection.connectionId,
      runId: result.run.id,
      chunk: chunk.index,
      since: chunk.since,
      until: chunk.until,
      deduplicated: result.deduplicated,
    });

    return { action: 'enqueued', runKind: 'backfill', runId: result.run.id };
  }

  /** Ids, dates and counts. Nothing here has been near a credential. */
  private log(event: string, payload: Record<string, unknown>): void {
    this.logger.log(`Social ad backfill ${event}: ${JSON.stringify(payload)}`);
  }
}
