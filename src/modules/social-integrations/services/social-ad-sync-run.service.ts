import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, QueryFailedError, Repository } from 'typeorm';
import { SocialAdCredentialResolver } from '../credentials/social-ad-credential.resolver';
import { SocialAdSyncRunEntity } from '../entities/social-ad-sync-run.entity';
import type { SocialAdSyncRunStatus } from '../entities/social-ad-sync-run.entity';
import type { SocialAdEntityLevel } from '../entities/social-ad-entity.entity';
import {
  assertClosedInsightsWindow,
  parseInsightsWindow,
} from '../sync/insights-window';
import { SocialAdSyncDisabledError } from '../sync/social-ad-sync-run.error';
import {
  SOCIAL_AD_SYNC_LEASE_MS,
  SYNC_ENTITY_LEVELS,
  buildSyncIdempotencyKey,
} from '../sync/social-ad-sync-run.contract';
import type {
  SocialAdSyncFailedSegment,
  SocialAdSyncRunKind,
} from '../sync/social-ad-sync-run.contract';
import {
  SocialAdSyncRunView,
  toSocialAdSyncRunView,
} from '../views/social-ad-sync-run.view';
import { SocialAdSyncConfigService } from './social-ad-sync-config.service';

const AGENCY_CONNECTION = 'agency';

/** Postgres' unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

/** The two states the in-flight unique index covers. */
const IN_FLIGHT: readonly SocialAdSyncRunStatus[] = ['queued', 'processing'];

/** States a run does not leave on its own. */
const SETTLED: readonly SocialAdSyncRunStatus[] = [
  'succeeded',
  'partial',
  'failed',
  'dead_letter',
  'cancelled',
];

/** How one backfill chunk ended, keyed by the day its window closes on. */
export type SocialAdBackfillChunkOutcome = {
  until: string;
  status: SocialAdSyncRunStatus;
};

export type EnqueueSyncRunInput = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  connectionId: string;
  provider: string;
  runKind: SocialAdSyncRunKind;
  /** Inclusive calendar window, or null for a run with no date dimension. */
  windowStart: string | null;
  windowEnd: string | null;
  entityLevels?: readonly SocialAdEntityLevel[];
  /**
   * Extra dimension of the intent, for a kind whose window does not identify
   * it. Only intraday uses one — every pass of a day asks for that same day —
   * and it must be a derived label such as a bucket of the account's own
   * clock, never a timestamp.
   */
  bucket?: string | null;
  /** NULL for a scheduled run; set when a person asked for it. */
  requestedById: string | null;
};

export type EnqueueSyncRunResult = {
  run: SocialAdSyncRunView;
  /**
   * The intent was already in flight and this call created nothing.
   *
   * Reported rather than hidden: a caller that asked twice deserves to know its
   * second request was answered by the first one's run, and a scheduler needs
   * it to tell "I enqueued the morning's work" from "it was already running".
   */
  deduplicated: boolean;
};

/** What one attempt actually did, accumulated onto the run. */
export type SocialAdSyncRunCounters = {
  rowsWritten: number;
  rowsSkipped: number;
  entitiesWritten: number;
  apiCalls: number;
};

export const EMPTY_RUN_COUNTERS: SocialAdSyncRunCounters = {
  rowsWritten: 0,
  rowsSkipped: 0,
  entitiesWritten: 0,
  apiCalls: 0,
};

export type FinishSyncRunInput = {
  runId: string;
  /**
   * The lease holder, as proof this worker is still the one running the run.
   *
   * Part of every terminal `WHERE`. Guarding on `status = 'processing'` alone
   * is not enough: a worker that paused past its lease has its run requeued and
   * re-claimed by somebody else, and by the time it wakes up the row is
   * `processing` again — under another worker. Matching the holder is what
   * makes a late result from an abandoned attempt apply to nothing.
   */
  lockedBy: string;
  counters: SocialAdSyncRunCounters;
  failedSegments?: readonly SocialAdSyncFailedSegment[];
  lastError?: string | null;
};

export type ListSyncRunsInput = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  connectionId: string;
  limit?: number;
};

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

/** How many times an enqueue may re-collide before it gives up. */
const ENQUEUE_MAX_ATTEMPTS = 3;

/**
 * The rows a statement returned, whichever shape the driver used.
 *
 * TypeORM's Postgres driver answers a `SELECT` with the row list and an
 * `UPDATE ... RETURNING` with `[rows, rowCount]`. Reading the second shape as
 * the first is silent and total: a `.length` check sees 2 for every update,
 * including the ones that matched nothing, so every guarded write would report
 * success and every recovery sweep would miscount what it swept.
 */
function returnedRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];

  const [first] = result as unknown[];

  // Rows are objects; a first element that is itself an array means this is
  // the `[rows, rowCount]` pair.
  return Array.isArray(first) ? (first as T[]) : (result as T[]);
}

/**
 * The lifecycle of `social_ad_sync_runs` — queue and history in one table.
 *
 * Everything that changes a run's state goes through here, so the invariants
 * live in one place: a claim always takes the lock and spends an attempt, a
 * finish always releases the lock, and no transition can be applied to a run
 * another instance has already moved on.
 *
 * That last property is the reason every terminal write carries
 * `WHERE ... AND status = 'processing' AND locked_by = <this worker>`. A worker
 * whose process paused long enough for its lease to expire is not a
 * hypothetical: the stale sweep will have requeued its run, another worker may
 * already be executing it, and a late `markSucceeded` from the first one would
 * overwrite a live attempt with the result of an abandoned one. Guarding on the
 * status alone does not catch it — by then the row *is* `processing` again, just
 * under somebody else — so the holder is part of the match. The update applies
 * to nothing, and the caller is told it did not.
 */
@Injectable()
export class SocialAdSyncRunService {
  private readonly logger = new Logger(SocialAdSyncRunService.name);

  constructor(
    @InjectRepository(SocialAdSyncRunEntity, AGENCY_CONNECTION)
    private readonly runsRepository: Repository<SocialAdSyncRunEntity>,
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    private readonly credentialResolver: SocialAdCredentialResolver,
    private readonly config: SocialAdSyncConfigService,
  ) {}

  /**
   * The endpoint's path into the queue: validate, then enqueue.
   *
   * Everything a request can get wrong is settled here, before a row exists.
   * A run created for a connection that cannot be read, or for a window that
   * includes an unfinished day, would be claimed, fail, retry, and finally
   * dead-letter — turning a mistake that could have been an immediate 409 into
   * five minutes of queue noise and a red card on the connection.
   *
   * The credential is resolved rather than merely looked up. It is the one
   * component that knows whether this connection can actually be read, and it
   * is also the only place the ad account's timezone comes from — which is what
   * decides whether the requested window is closed. Nothing is done with the
   * token; it is resolved, its metadata is used, and it goes out of scope.
   */
  async request(input: {
    tenantId: string;
    workspaceId: string;
    agencyClientId: string | null;
    connectionId: string;
    /** Both or neither: a window turns the run from `entities` into `manual`. */
    since?: string;
    until?: string;
    requestedById: string | null;
    now?: Date;
  }): Promise<EnqueueSyncRunResult> {
    /**
     * Checked first, and it is a refusal rather than a queued row.
     *
     * A disabled runtime with an accepting endpoint is the worst of both: the
     * caller is told the work was accepted, the list fills with runs that never
     * start, and the symptom is indistinguishable from a wedged worker. It also
     * reveals nothing — the switch is global and says nothing about the
     * connection in the path.
     */
    if (!this.config.enabled) {
      throw new SocialAdSyncDisabledError();
    }

    // Both or neither. One half of a window is a typo, and reading it as "no
    // window" would answer a different question — a hierarchy refresh — while
    // looking like it accepted the one that was asked.
    if ((input.since === undefined) !== (input.until === undefined)) {
      throw new BadRequestException(
        'since and until must be provided together.',
      );
    }

    const credential = await this.credentialResolver.resolve({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agencyClientId: input.agencyClientId,
      connectionId: input.connectionId,
    });

    const window =
      input.since !== undefined && input.until !== undefined
        ? parseInsightsWindow({ since: input.since, until: input.until })
        : null;

    if (window) {
      // After the scoped resolve, deliberately: answering it earlier would let
      // a caller learn a connection's timezone — and that it exists — by
      // watching which refusal comes back for somebody else's connection.
      assertClosedInsightsWindow(window, credential.timezone, input.now);
    }

    // Scope and provider come from the resolved row, never from the request.
    // They are equal by construction — the row was found *by* the request — and
    // taking the stored truth is what keeps a queued run from executing under a
    // scope a caller merely claimed.
    return this.enqueue({
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      connectionId: credential.connectionId,
      provider: credential.provider,
      runKind: window ? 'manual' : 'entities',
      windowStart: window?.since ?? null,
      windowEnd: window?.until ?? null,
      requestedById: input.requestedById,
    });
  }

  /**
   * Whether this exact intent has already been attempted to a conclusion.
   *
   * The scheduler's guard against enqueueing the same morning twice. In-flight
   * duplicates are the unique index's job; this covers the other half — a run
   * that finished, succeeded or not. Failure counts: a daily run that
   * dead-lettered at 04:00 must not be re-enqueued at 05:00 and every hour
   * after, which is how a broken connection becomes twenty runs a day.
   */
  async hasSettledRun(
    connectionId: string,
    idempotencyKey: string,
  ): Promise<boolean> {
    const count = await this.runsRepository.count({
      where: SETTLED.map((status) => ({
        connectionId,
        idempotencyKey,
        status,
      })),
    });

    return count > 0;
  }

  /**
   * Whether this connection has a run of any of these kinds still going.
   *
   * The backfill chain's throttle. The in-flight unique index already stops the
   * *same* chunk from being enqueued twice; this is the different question of
   * whether the chain should produce its *next* piece of work at all, and the
   * answer is no while the previous piece is queued or running. One chunk in
   * flight per connection is what keeps a thirteen-week sweep from filling the
   * queue ahead of every other account's morning.
   */
  async hasInFlightRun(
    connectionId: string,
    runKinds: readonly SocialAdSyncRunKind[],
  ): Promise<boolean> {
    if (runKinds.length === 0) return false;

    const count = await this.runsRepository.count({
      where: IN_FLIGHT.flatMap((status) =>
        runKinds.map((runKind) => ({ connectionId, runKind, status })),
      ),
    });

    return count > 0;
  }

  /**
   * Every backfill chunk this connection has ever had, with how it ended.
   *
   * The chain's whole memory, and it lives here rather than in a flag on the
   * connection because a flag would be a second copy of this that disagrees the
   * first time a run is retried, cancelled, or made by hand.
   *
   * Three questions come out of one read, and they need *different* answers per
   * status, which is why this returns outcomes rather than a list of days:
   *
   * - *Where is the plan anchored?* The newest window end, whatever its status.
   *   The anchor is the first chunk the chain ever produced and must not move
   *   when a chunk fails.
   * - *Which chunks are covered?* Only `succeeded`. A chunk that ended
   *   `partial`, `failed`, `dead_letter` or `cancelled` fetched some or none of
   *   its week, and calling that covered is how a quarter of a client's spend
   *   ends up with a hole nothing will ever fill.
   * - *Which chunks are unresolved?* Everything else. The chain stops at the
   *   oldest of these rather than stepping over it, so an operator sees a
   *   stalled backfill instead of a complete-looking one with a missing week.
   *
   * Returned as text, from Postgres' own formatting: a `date` read back through
   * a driver that decides to hand out a `Date` would be re-expressed in the
   * server's timezone, and this value is compared against days computed in the
   * ad account's.
   */
  async listBackfillChunkOutcomes(
    connectionId: string,
  ): Promise<SocialAdBackfillChunkOutcome[]> {
    const rows = await this.runsRepository
      .createQueryBuilder('run')
      .select(`to_char(run.window_end, 'YYYY-MM-DD')`, 'until')
      .addSelect('run.status', 'status')
      .where('run.connection_id = :connectionId', { connectionId })
      .andWhere(`run.run_kind = 'backfill'`)
      .andWhere('run.window_end IS NOT NULL')
      /**
       * A total order, and every part of it is load-bearing.
       *
       * `window_end DESC` puts the plan's anchor first. On its own that is not
       * deterministic: a window can hold several runs — a resumed chunk is a
       * second run of the same window by construction — and Postgres is free to
       * return ties in whatever order the plan produces, which changes with the
       * table's physical layout, the statistics, and the plan the optimizer
       * happens to choose. The anchor is `[0].until`, so an undefined tie order
       * would be an anchor that is *usually* right.
       *
       * `created_at` then `id` break the tie the same way every time: oldest
       * attempt first within a window, and `id` as the final discriminator for
       * two runs created inside the same clock tick. Nothing here depends on
       * insertion order or on natural order.
       */
      .orderBy('run.window_end', 'DESC')
      .addOrderBy('run.created_at', 'ASC')
      .addOrderBy('run.id', 'ASC')
      .getRawMany<{ until: string; status: SocialAdSyncRunStatus }>();

    return rows.map((row) => ({ until: row.until, status: row.status }));
  }

  /**
   * Records an intent to sync, or hands back the one already in flight.
   *
   * The deduplication is done by the database, not by a read-then-write. A
   * check for an existing run followed by an insert is two statements with a
   * gap, and two callers arriving inside that gap both find nothing and both
   * insert — which is precisely the "sync now" double-click this is meant to
   * absorb. So the insert is attempted, and the partial unique index is what
   * decides. A unique violation is not an error here; it is the answer.
   */
  async enqueue(
    input: EnqueueSyncRunInput,
    attempt = 1,
  ): Promise<EnqueueSyncRunResult> {
    const entityLevels = input.entityLevels ?? SYNC_ENTITY_LEVELS;

    const idempotencyKey = buildSyncIdempotencyKey({
      connectionId: input.connectionId,
      runKind: input.runKind,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      entityLevels,
      bucket: input.bucket ?? null,
    });

    try {
      const run = await this.runsRepository.save(
        this.runsRepository.create({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          agencyClientId: input.agencyClientId,
          connectionId: input.connectionId,
          provider: input.provider,
          runKind: input.runKind,
          status: 'queued',
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          entityLevels: [...entityLevels],
          idempotencyKey,
          requestedById: input.requestedById,
          // Left at the column defaults on purpose: `available_at` is now(),
          // `attempts` is 0, `max_attempts` is 5, and restating them here would
          // create a second place to change the retry ceiling.
        }),
      );

      return { run: toSocialAdSyncRunView(run), deduplicated: false };
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;

      const existing = await this.findInFlight(
        input.connectionId,
        idempotencyKey,
      );

      /**
       * The row that caused the violation is gone already.
       *
       * Narrow but real: the in-flight run finished between the failed insert
       * and this lookup, which releases the partial index. Retrying is correct
       * — the next insert either succeeds or collides with a run that is still
       * there — and it is bounded, because a caller waiting on an unbounded
       * loop is a worse failure than a caller told the write did not land.
       */
      if (!existing) {
        if (attempt >= ENQUEUE_MAX_ATTEMPTS) throw error;

        return this.enqueue(input, attempt + 1);
      }

      return { run: toSocialAdSyncRunView(existing), deduplicated: true };
    }
  }

  /**
   * Takes up to `limit` due runs for this worker, exclusively.
   *
   * `FOR UPDATE SKIP LOCKED` is the whole concurrency story: two instances
   * ticking at the same millisecond each lock a disjoint set of rows, and
   * neither waits for the other. Without `SKIP LOCKED` the second instance
   * would block on the first one's rows and then claim them anyway once the
   * transaction committed — the lock would have serialized the workers instead
   * of partitioning the work.
   *
   * The select and the status update are one transaction, so a row is never
   * observable as "locked by a transaction but still queued".
   *
   * Deliberately does *not* sweep stale leases. A claim query that also picked
   * up expired `processing` rows would resurrect them without consulting
   * `max_attempts`, and a run that has already failed five times would be
   * retried forever by the recovery path it was supposed to leave.
   */
  async claim(input: {
    workerId: string;
    limit: number;
    now?: Date;
  }): Promise<SocialAdSyncRunEntity[]> {
    const now = input.now ?? new Date();
    const limit = Math.max(1, Math.trunc(input.limit));

    const ids = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<{ id: string }[]>(
        `SELECT id
           FROM social_ad_sync_runs
          WHERE status = 'queued'
            AND available_at <= $1
          ORDER BY available_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT $2`,
        [now, limit],
      );

      if (rows.length === 0) return [];

      const claimedIds = rows.map((row) => row.id);

      await manager.query(
        `UPDATE social_ad_sync_runs
            SET status = 'processing',
                locked_at = $2,
                locked_by = $3,
                started_at = COALESCE(started_at, $2),
                attempts = attempts + 1,
                updated_at = now()
          WHERE id = ANY($1::uuid[])`,
        [claimedIds, now, input.workerId],
      );

      return claimedIds;
    });

    if (ids.length === 0) return [];

    // Re-read outside the claiming transaction: the rows are ours now, and
    // holding the transaction open while the pipeline runs would keep a
    // database connection and its row locks for the length of a Graph walk.
    return this.runsRepository.find({ where: ids.map((id) => ({ id })) });
  }

  /**
   * Returns runs whose worker died holding the lease.
   *
   * Nothing else can recover them: the process that owned the lock is gone, so
   * it will never call `markFailed`, and the row would otherwise sit in
   * `processing` forever — invisible to the claim query, and indistinguishable
   * from a run that is legitimately still working.
   *
   * Attempts decide where it goes. A run with tries left goes back to `queued`
   * and available immediately, because the lease expiring is itself evidence
   * that time has already passed. A run that has spent them becomes
   * `dead_letter` — the state that means "gave up", not "will try again".
   */
  async recoverStale(input: { now?: Date; leaseMs?: number } = {}): Promise<{
    requeued: number;
    deadLettered: number;
  }> {
    const now = input.now ?? new Date();
    const expiredBefore = new Date(
      now.getTime() - (input.leaseMs ?? SOCIAL_AD_SYNC_LEASE_MS),
    );

    const result: unknown = await this.dataSource.query(
      `UPDATE social_ad_sync_runs
          SET status = CASE
                WHEN attempts >= max_attempts THEN 'dead_letter'
                ELSE 'queued'
              END,
              available_at = CASE
                WHEN attempts >= max_attempts THEN available_at
                ELSE $2
              END,
              finished_at = CASE
                WHEN attempts >= max_attempts THEN $2
                ELSE finished_at
              END,
              locked_at = NULL,
              locked_by = NULL,
              last_error = 'lease_expired',
              updated_at = now()
        WHERE status = 'processing'
          AND locked_at IS NOT NULL
          AND locked_at < $1
        RETURNING status`,
      [expiredBefore, now],
    );

    const rows = returnedRows<{ status: string }>(result);
    const requeued = rows.filter((row) => row.status === 'queued').length;
    const deadLettered = rows.length - requeued;

    if (rows.length > 0) {
      this.logger.warn(
        `Recovered stale Social ad sync runs: ${JSON.stringify({
          requeued,
          deadLettered,
        })}`,
      );
    }

    return { requeued, deadLettered };
  }

  /** Every segment completed. */
  markSucceeded(input: FinishSyncRunInput): Promise<boolean> {
    return this.finish('succeeded', input);
  }

  /**
   * Some segments completed and some did not, and no retry will follow.
   *
   * Terminal on purpose, and only reached once retrying has been ruled out —
   * either the failure is not the kind time fixes, or the attempts are spent.
   * A run that still has a retry coming goes to `reschedule` instead, even
   * though it also wrote some segments and not others: `partial` says "this is
   * how the run ended", and a run with a backoff scheduled has not ended.
   *
   * The rows that were written stay written — they are correct facts about the
   * days they cover, and deleting them to make the run look clean would throw
   * away the only part that worked.
   */
  markPartial(input: FinishSyncRunInput): Promise<boolean> {
    return this.finish('partial', input);
  }

  /** Nothing landed, and retrying will not change that. */
  markFailed(input: FinishSyncRunInput): Promise<boolean> {
    return this.finish('failed', input);
  }

  /** Nothing landed, and the attempts are spent. */
  markDeadLetter(input: FinishSyncRunInput): Promise<boolean> {
    return this.finish('dead_letter', input);
  }

  /**
   * Back to the queue, not before `availableAt`.
   *
   * The lock is released and `finished_at` stays NULL: the run is not over, and
   * a finish timestamp on a row that will run again would make the history read
   * as a completed attempt.
   *
   * `failed_segments` is written here as the *retry plan* rather than as a
   * post-mortem. It lists everything the attempt did not complete, so the next
   * claim re-runs exactly that and does not pay again for the segments that
   * already landed.
   */
  async reschedule(
    input: FinishSyncRunInput & { availableAt: Date },
  ): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE social_ad_sync_runs
          SET status = 'queued',
              available_at = $2,
              rows_written = rows_written + $3,
              rows_skipped = rows_skipped + $4,
              entities_written = entities_written + $5,
              api_calls = api_calls + $6,
              failed_segments = $7::jsonb,
              last_error = $8,
              locked_at = NULL,
              locked_by = NULL,
              updated_at = now()
        WHERE id = $1
          AND status = 'processing'
          AND locked_by = $9
        RETURNING id`,
      [
        input.runId,
        input.availableAt,
        input.counters.rowsWritten,
        input.counters.rowsSkipped,
        input.counters.entitiesWritten,
        input.counters.apiCalls,
        JSON.stringify(input.failedSegments ?? []),
        input.lastError ?? null,
        input.lockedBy,
      ],
    );

    return returnedRows(result).length > 0;
  }

  /**
   * The most recent runs for one connection, sanitized.
   *
   * Scoped on the run's own columns, which were copied from the connection at
   * enqueue. A caller from another tenant, workspace or managed client gets an
   * empty list — the same answer as a connection with no history, so the
   * endpoint confirms nothing about whether the id exists.
   */
  async listRecent(input: ListSyncRunsInput): Promise<SocialAdSyncRunView[]> {
    const take = Math.min(
      MAX_LIST_LIMIT,
      Math.max(1, Math.trunc(input.limit ?? DEFAULT_LIST_LIMIT)),
    );

    const runs = await this.runsRepository.find({
      where: {
        connectionId: input.connectionId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        // `IsNull()` rather than `null`: agency scope has to match rows where
        // the column is NULL, and TypeORM reads a literal null as "no filter"
        // — which here would list every managed client's runs.
        agencyClientId: input.agencyClientId ?? IsNull(),
      },
      order: { createdAt: 'DESC' },
      take,
    });

    return runs.map(toSocialAdSyncRunView);
  }

  /** Loads one run for a caller that already proved its scope. */
  findById(runId: string): Promise<SocialAdSyncRunEntity | null> {
    return this.runsRepository.findOne({ where: { id: runId } });
  }

  private async finish(
    status: SocialAdSyncRunStatus,
    input: FinishSyncRunInput,
  ): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `UPDATE social_ad_sync_runs
          SET status = $2,
              rows_written = rows_written + $3,
              rows_skipped = rows_skipped + $4,
              entities_written = entities_written + $5,
              api_calls = api_calls + $6,
              failed_segments = $7::jsonb,
              last_error = $8,
              finished_at = now(),
              locked_at = NULL,
              locked_by = NULL,
              updated_at = now()
        WHERE id = $1
          AND status = 'processing'
          AND locked_by = $9
        RETURNING id`,
      [
        input.runId,
        status,
        input.counters.rowsWritten,
        input.counters.rowsSkipped,
        input.counters.entitiesWritten,
        input.counters.apiCalls,
        JSON.stringify(input.failedSegments ?? []),
        input.lastError ?? null,
        input.lockedBy,
      ],
    );

    return returnedRows(result).length > 0;
  }

  private findInFlight(connectionId: string, idempotencyKey: string) {
    return this.runsRepository.findOne({
      where: IN_FLIGHT.map((status) => ({
        connectionId,
        idempotencyKey,
        status,
      })),
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;

    const driverError = error.driverError as { code?: unknown } | undefined;

    return driverError?.code === UNIQUE_VIOLATION;
  }
}
