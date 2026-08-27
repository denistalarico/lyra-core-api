import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { hostname } from 'node:os';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { SocialAdCredentialResolver } from '../credentials/social-ad-credential.resolver';
import type { SocialAdSyncRunEntity } from '../entities/social-ad-sync-run.entity';
import {
  assertClosedInsightsWindow,
  parseInsightsWindow,
  type InsightsWindow,
} from '../sync/insights-window';
import {
  SYNC_SEGMENTS_BY_KIND,
  type SocialAdSyncFailedSegment,
  type SocialAdSyncRunKind,
  type SocialAdSyncSegment,
} from '../sync/social-ad-sync-run.contract';
import { SocialAdSyncRunPlanError } from '../sync/social-ad-sync-run.error';
import {
  classifySocialAdSyncRetry,
  nextAvailableAt,
} from '../sync/social-ad-sync-retry';
import { SocialAdConnectionService } from './social-ad-connection.service';
import { SocialAdHierarchySyncService } from './social-ad-hierarchy-sync.service';
import { SocialAdInsightsSyncService } from './social-ad-insights-sync.service';
import { SocialAdSyncConfigService } from './social-ad-sync-config.service';
import {
  SocialAdSyncRunService,
  type SocialAdSyncRunCounters,
} from './social-ad-sync-run.service';

/** How often the queue is looked at. */
const TICK_MS = 5_000;

/**
 * Runs taken per tick.
 *
 * One. A run is a walk over a provider that meters CPU time against a
 * business-wide quota, and two runs of the same account in parallel spend that
 * quota racing each other. The claim query is built for a batch — `SKIP LOCKED`
 * and a `LIMIT` — so raising this is a constant, not a rewrite; it stays at one
 * until there is evidence that the queue, rather than Meta, is the bottleneck.
 */
const CLAIM_LIMIT = 1;

/**
 * Executes queued Social ad syncs.
 *
 * An orchestrator and nothing else. Every read, every normalization and every
 * write already exists and is proven: the hierarchy sweep is S2.3's, the
 * insights ingest is S2.4's, the credential comes from the S2.1 resolver. What
 * this class adds is the part that only a durable queue can have — a lease, an
 * attempt count, a backoff, and a record of what happened that survives the
 * process.
 *
 * The one thing it must never do is re-implement a step. A second Graph call, a
 * second normalizer or a second writer here would be a copy that drifts from
 * the one the synchronous endpoints use, and the copy that drifts is always the
 * one with fewer readers — which here is the one that runs unattended at four
 * in the morning.
 */
@Injectable()
export class SocialAdSyncWorker {
  private readonly logger = new Logger(SocialAdSyncWorker.name);

  /**
   * Who holds a lease.
   *
   * Host and pid, so a stuck run can be traced to a process that may still be
   * alive. It is written to `locked_by` and deliberately never leaves the
   * database: `toSocialAdSyncRunView` drops it, because a deployment's host
   * names are not a caller's business.
   */
  private readonly workerId = `${hostname()}:${process.pid}:social-sync`;

  /** One tick at a time in this process; `SKIP LOCKED` handles the others. */
  private running = false;

  constructor(
    private readonly config: SocialAdSyncConfigService,
    private readonly runService: SocialAdSyncRunService,
    private readonly credentialResolver: SocialAdCredentialResolver,
    private readonly hierarchySync: SocialAdHierarchySyncService,
    private readonly insightsSync: SocialAdInsightsSyncService,
    private readonly connectionService: SocialAdConnectionService,
  ) {}

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    if (!this.config.enabled || this.running) return;

    this.running = true;

    try {
      // Before the claim, so a run abandoned by a dead worker is back in the
      // queue in time to be picked up by this very tick.
      await this.runService.recoverStale();
      await this.processDue(CLAIM_LIMIT);
    } catch (error) {
      // The cycle itself failed — a database outage, not a run. Runs record
      // their own failures; this only exists so a broken tick is visible
      // instead of silently ending the interval.
      this.logger.error(
        `Social ad sync cycle failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Claims and executes due runs. Public so tests can drive one cycle. */
  async processDue(limit = CLAIM_LIMIT): Promise<number> {
    const runs = await this.runService.claim({
      workerId: this.workerId,
      limit,
    });

    for (const run of runs) {
      await this.processOne(run);
    }

    return runs.length;
  }

  private async processOne(run: SocialAdSyncRunEntity): Promise<void> {
    const counters: SocialAdSyncRunCounters = {
      rowsWritten: 0,
      rowsSkipped: 0,
      entitiesWritten: 0,
      apiCalls: 0,
    };

    const plan = this.planFor(run);
    const completed: SocialAdSyncSegment[] = [];

    let credential: ResolvedAdCredential;

    try {
      /**
       * Resolved from the run's own scope columns, which were written from a
       * resolved credential at enqueue.
       *
       * The resolver scopes the lookup again anyway, so a run whose connection
       * has since moved out of that scope resolves to nothing and fails rather
       * than reading an account it no longer covers. A worker holding a
       * connection id is not a worker holding permission.
       */
      credential = await this.credentialResolver.resolve({
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        agencyClientId: run.agencyClientId,
        connectionId: run.connectionId,
      });
    } catch (error) {
      // Nothing ran, so every planned segment is outstanding.
      await this.settle({
        run,
        counters,
        completed,
        plan,
        failed: null,
        error,
      });

      return;
    }

    // One instant for the attempt, stamped on every fact it writes — the same
    // rule the synchronous ingest follows, so "how fresh is this number" has
    // one answer per run regardless of which segment wrote it.
    const syncedAt = new Date();

    for (const segment of plan) {
      try {
        await this.executeSegment({
          run,
          segment,
          credential,
          syncedAt,
          counters,
        });
        completed.push(segment);
      } catch (error) {
        /**
         * Stops at the first failure rather than trying the rest.
         *
         * The failures that reach here are overwhelmingly account-wide — a rate
         * limit, an expired token, Meta refusing the account — and the next
         * segment would spend another request discovering the same thing. On a
         * rate limit that is worse than useless: it spends quota that has
         * already run out, which is what pushes a business further into the
         * penalty window.
         */
        await this.settle({
          run,
          counters,
          completed,
          plan,
          failed: segment,
          error,
        });

        return;
      }
    }

    await this.settle({
      run,
      counters,
      completed,
      plan,
      failed: null,
      error: null,
    });
  }

  /**
   * What this attempt should execute.
   *
   * `failed_segments` is the retry plan, not a post-mortem: a rescheduled run
   * carries everything the last attempt did not complete, so the next one
   * re-runs exactly that. An empty column means a first attempt, and a first
   * attempt runs the whole plan for its kind.
   *
   * The stored plan is filtered against the kind's own segment list. A jsonb
   * column is whatever was written to it, and a value that does not name a real
   * segment of this run must not become work.
   */
  private planFor(run: SocialAdSyncRunEntity): readonly SocialAdSyncSegment[] {
    const full =
      SYNC_SEGMENTS_BY_KIND[run.runKind as SocialAdSyncRunKind] ?? [];

    if (!Array.isArray(run.failedSegments) || run.failedSegments.length === 0) {
      return full;
    }

    const outstanding = new Set(
      run.failedSegments
        .map((entry) =>
          typeof entry === 'object' && entry !== null
            ? (entry as { segment?: unknown }).segment
            : null,
        )
        .filter((segment): segment is string => typeof segment === 'string'),
    );

    const resumed = full.filter((segment) => outstanding.has(segment));

    // A stored plan that matches nothing real is not a reason to do nothing:
    // the run was created to do something, so it falls back to its full plan.
    return resumed.length > 0 ? resumed : full;
  }

  private async executeSegment(input: {
    run: SocialAdSyncRunEntity;
    segment: SocialAdSyncSegment;
    credential: ResolvedAdCredential;
    syncedAt: Date;
    counters: SocialAdSyncRunCounters;
  }): Promise<void> {
    const { counters } = input;

    if (input.segment === 'hierarchy') {
      const summary = await this.hierarchySync.syncHierarchyWith(
        input.credential,
      );

      counters.entitiesWritten += summary.entitiesWritten;
      counters.apiCalls += summary.apiCalls;
      // `rows_skipped` counts everything the pipeline could not use, whichever
      // level produced it: an unkeyable ad and an unreadable daily row are the
      // same fact about a run — it saw something it could not store.
      counters.rowsSkipped += summary.levels.reduce(
        (total, level) => total + level.skipped,
        0,
      );

      return;
    }

    const window = this.requireWindow(input.run);

    /**
     * Re-checked here, not only at enqueue.
     *
     * A queued run can execute much later than it was created, and the check is
     * what guarantees no open day is ever written with `is_partial = false`.
     * Time only ever makes a closed window more closed, so this never turns a
     * valid run invalid — it is the guard against a row whose window was not
     * written by the enqueue path at all.
     */
    assertClosedInsightsWindow(window, input.credential.timezone);

    const summary = await this.insightsSync.ingestLevel({
      credential: input.credential,
      level: input.segment === 'account_insights' ? 'account' : 'campaign',
      window,
      syncedAt: input.syncedAt,
    });

    counters.rowsWritten += summary.written;
    counters.rowsSkipped += summary.skipped;
    counters.apiCalls += summary.apiCalls;
  }

  private requireWindow(run: SocialAdSyncRunEntity): InsightsWindow {
    if (!run.windowStart || !run.windowEnd) {
      throw new SocialAdSyncRunPlanError('run_window_missing');
    }

    // Re-validated rather than trusted: the row is stored state, and the same
    // parser that guards the endpoint should guard the worker.
    return parseInsightsWindow({
      since: this.readDay(run.windowStart),
      until: this.readDay(run.windowEnd),
    });
  }

  /** A `date` column arrives as a string from Postgres, a Date from memory. */
  private readDay(value: string | Date): string {
    return value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value);
  }

  /**
   * Decides what this attempt was, writes it, and updates the connection.
   *
   * Two questions decide the outcome, **in this order**, and the order is the
   * whole state machine:
   *
   * 1. *Will there be another attempt?* — the failure is one that time fixes
   *    (transient, rate limited, unclassified) **and** attempts remain.
   * 2. Only if not: *did anything land?*
   *
   * Retry wins over partial. A run that wrote the hierarchy and then hit a rate
   * limit goes back to `queued` with a backoff — it is not `partial`, because
   * `partial` says "this is how the run ended" and the run has not ended.
   * Marking it partial and then retrying anyway would put a terminal state in
   * the history of a run that is still going.
   *
   * So the five outcomes:
   *
   * - **succeeded** — every planned segment finished.
   * - **queued again** — question 1 said yes. Progress is kept, the backoff is
   *   set, and `failed_segments` becomes the plan the next claim executes.
   * - **partial** — question 1 said no and something had landed. Terminal: no
   *   claim will pick this run up again. The written rows stay written; they
   *   are correct facts about the days they cover.
   * - **failed** — nothing landed and retrying is pointless. The honest answer
   *   for an expired token.
   * - **dead_letter** — nothing landed, it was worth retrying, and the tries
   *   are spent. Kept distinct from `failed` so an operator can tell "gave up"
   *   from "needs thirty seconds of your attention".
   *
   * `failed_segments` is written in both the retry case and the terminal ones,
   * and it means the same thing in both — *what this run has not done*. While
   * the run is `queued` that reads as a plan; once it is `partial` the same
   * list reads as a record of the hole. Nothing re-executes it in the second
   * case, because nothing claims a settled run.
   */
  private async settle(input: {
    run: SocialAdSyncRunEntity;
    counters: SocialAdSyncRunCounters;
    completed: readonly SocialAdSyncSegment[];
    plan: readonly SocialAdSyncSegment[];
    failed: SocialAdSyncSegment | null;
    error: unknown;
  }): Promise<void> {
    const { run, counters } = input;
    const wrote = counters.rowsWritten + counters.entitiesWritten > 0;

    if (input.error === null) {
      await this.runService.markSucceeded({
        runId: run.id,
        lockedBy: this.workerId,
        counters,
        failedSegments: [],
        lastError: null,
      });

      await this.connectionService.recordSyncOutcome({
        connectionId: run.connectionId,
        syncedAt: new Date(),
        error: null,
      });

      this.log(run, 'succeeded', counters, null);

      return;
    }

    const policy = classifySocialAdSyncRetry(input.error);
    const failedSegments = this.outstandingSegments(input, policy.code);
    const attemptsLeft = run.attempts < run.maxAttempts;

    if (policy.action !== 'stop' && attemptsLeft) {
      await this.runService.reschedule({
        runId: run.id,
        lockedBy: this.workerId,
        counters,
        failedSegments,
        lastError: policy.code,
        availableAt: nextAvailableAt({
          action: policy.action,
          attempts: run.attempts,
          retryAfterMs: policy.retryAfterMs,
          now: new Date(),
        }),
      });

      await this.recordFreshness(run, wrote, policy.code);
      this.log(run, 'requeued', counters, policy.code);

      return;
    }

    const finish = {
      runId: run.id,
      lockedBy: this.workerId,
      counters,
      failedSegments,
      lastError: policy.code,
    };

    if (input.completed.length > 0) {
      await this.runService.markPartial(finish);
    } else if (policy.action === 'stop') {
      await this.runService.markFailed(finish);
    } else {
      await this.runService.markDeadLetter(finish);
    }

    await this.recordFreshness(run, wrote, policy.code);
    this.log(run, 'stopped', counters, policy.code);
  }

  /**
   * Everything this attempt did not complete, as the next attempt's plan.
   *
   * The segment that failed carries the real code. The ones after it carry
   * `not_attempted`, which is what actually happened to them — labelling them
   * with the failure they never reached would put five identical rate-limit
   * codes in the log for one rate limit.
   */
  private outstandingSegments(
    input: {
      completed: readonly SocialAdSyncSegment[];
      plan: readonly SocialAdSyncSegment[];
      failed: SocialAdSyncSegment | null;
    },
    code: string,
  ): SocialAdSyncFailedSegment[] {
    const done = new Set(input.completed);

    return input.plan
      .filter((segment) => !done.has(segment))
      .map((segment) => ({
        segment,
        errorCode: segment === input.failed ? code : 'not_attempted',
      }));
  }

  /**
   * The connection card, after an attempt that did not fully succeed.
   *
   * `last_synced_at` advances whenever facts landed, even on a run that will be
   * retried, because the column describes the connection rather than the run:
   * data is stored as of now, and saying otherwise would show a connection as
   * staler than it is.
   */
  private recordFreshness(
    run: SocialAdSyncRunEntity,
    wrote: boolean,
    code: string,
  ) {
    return this.connectionService.recordSyncOutcome({
      connectionId: run.connectionId,
      syncedAt: wrote ? new Date() : null,
      error: code,
    });
  }

  /**
   * One line per attempt, assembled field by field.
   *
   * Ids and counts only. No credential, no provider message, no window content
   * beyond what the run already published — the codes here come from the same
   * classifier the HTTP responses use, so nothing is logged that a caller could
   * not already read.
   */
  private log(
    run: SocialAdSyncRunEntity,
    outcome: string,
    counters: SocialAdSyncRunCounters,
    code: string | null,
  ): void {
    const payload = JSON.stringify({
      runId: run.id,
      connectionId: run.connectionId,
      kind: run.runKind,
      attempt: run.attempts,
      outcome,
      ...counters,
      ...(code ? { code } : {}),
    });

    if (code) {
      this.logger.warn(`Social ad sync run ${outcome}: ${payload}`);
    } else {
      this.logger.log(`Social ad sync run ${outcome}: ${payload}`);
    }
  }
}
