import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  DEFAULT_RETENTION_DAYS,
  RETENTION_DAYS_BY_KIND,
  RETENTION_DAYS_BY_STATUS,
  RETENTION_EXEMPT_RUN_KIND,
  RETENTION_NEVER_DELETED_STATUSES,
} from '../sync/social-ad-retention.policy';
import { SocialAdRetentionConfigService } from './social-ad-retention-config.service';

const AGENCY_CONNECTION = 'agency';

export type SocialAdRetentionResult = {
  /** Rows actually removed. Zero is the expected steady state. */
  deleted: number;
  /**
   * Whether the batch limit was reached, meaning more candidates remain.
   *
   * Reported rather than looped on: the caller decides whether to continue,
   * and a service that drained the whole backlog in one call would be exactly
   * the unbounded delete the batch exists to prevent.
   */
  hadMore: boolean;
  /** Rows removed per bucket, for the one log line this job emits. */
  byBucket: Record<string, number>;
  durationMs: number;
  /** Null when the sweep was skipped because the switch is off. */
  skipped: 'disabled' | null;
};

/**
 * Deletes sync-run log rows whose retention period has elapsed.
 *
 * ## Only this table, and only these rows
 *
 * Nothing else is reachable from here. The service holds one statement, it
 * names `social_ad_sync_runs` literally, and the facts are protected twice
 * over: by the statement not mentioning them, and by the schema itself —
 * `social_ad_metrics_daily.sync_run_id` is `ON DELETE SET NULL`, so removing a
 * run drops the provenance pointer and leaves the fact. That is a deliberate
 * property of the S2.2 migration rather than a coincidence, and it is what
 * makes this sweep safe to run without touching the read model at all.
 *
 * ## Why one statement instead of select-then-delete
 *
 * A sweep that read candidate ids and then deleted them would have a gap
 * between the two, and the rows in that gap are precisely the interesting ones:
 * a run that finishes inside it would be deleted on the strength of a status it
 * no longer has. Doing the whole thing as one `DELETE ... WHERE id IN (SELECT
 * ... FOR UPDATE SKIP LOCKED)` closes the gap — the predicate is evaluated
 * against rows the statement holds locked.
 *
 * ## Concurrency
 *
 * `FOR UPDATE SKIP LOCKED` in the subquery is what makes two instances safe.
 * There is one API instance today, but a second one is a deployment decision
 * rather than a code change, and the failure without this would be silent:
 * both sweeps would select overlapping ids, one would block on the other's
 * locks, and the second would then delete rows already gone — wasted work
 * reported as deletions. With `SKIP LOCKED` each sweep takes a disjoint set and
 * neither waits. No distributed lock is needed, and one would be a coordination
 * dependency bought for a job that is already idempotent by construction: a
 * second run finds nothing, because the rows it would have deleted are gone.
 *
 * ## The predicate is fixed
 *
 * Every value the policy contributes is bound as a parameter, and the shape of
 * the statement is a constant string. Nothing here interpolates a table name, a
 * status or a column, and there is no caller-supplied input at all — retention
 * has no endpoint. The kind and status lists come from the policy module, so
 * they are the same values the pure `decideRetention` uses; the gated spec runs
 * both over identical fixtures so the SQL and the function cannot drift.
 */
@Injectable()
export class SocialAdRetentionService {
  private readonly logger = new Logger(SocialAdRetentionService.name);

  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    private readonly config: SocialAdRetentionConfigService,
  ) {}

  /**
   * Runs one batch.
   *
   * Global by design: there is no request, no tenant and no connection in
   * scope, because this is housekeeping over a log table rather than an
   * operation on anybody's data. Rows from every tenant are eligible in the
   * same batch, which is safe precisely because the rule reads only
   * `run_kind`, `status` and `finished_at` — none of which is tenant-specific —
   * and because nothing downstream of a deleted row is scoped either.
   */
  async sweep(input: { now?: Date } = {}): Promise<SocialAdRetentionResult> {
    const startedAt = Date.now();

    if (!this.config.enabled) {
      return {
        deleted: 0,
        hadMore: false,
        byBucket: {},
        durationMs: 0,
        skipped: 'disabled',
      };
    }

    const now = input.now ?? new Date();
    const limit = this.config.batchSize;

    const rows = await this.deleteBatch(now, limit);
    const byBucket = this.countByBucket(rows);
    const durationMs = Date.now() - startedAt;

    const result: SocialAdRetentionResult = {
      deleted: rows.length,
      hadMore: rows.length >= limit,
      byBucket,
      durationMs,
      skipped: null,
    };

    // One line per sweep, not per row. Counts, kinds, statuses and a duration —
    // no ids, no windows, no error payloads, and nothing that has been near a
    // credential. A quiet sweep says nothing at all, because a daily "deleted
    // 0 rows" for months is how a log stops being read.
    if (result.deleted > 0) {
      this.logger.log(
        `Social ad sync run retention swept: ${JSON.stringify({
          deleted: result.deleted,
          hadMore: result.hadMore,
          byBucket,
          durationMs,
        })}`,
      );
    }

    return result;
  }

  /**
   * The one statement, and the whole policy expressed in SQL.
   *
   * Read alongside `decideRetention`, which this must agree with clause for
   * clause:
   *
   * - `run_kind <> 'backfill'` — the exemption, at every status.
   * - `status <> ALL(...)` — `queued` and `processing` are out of reach.
   * - `finished_at IS NOT NULL` — fail closed on an undateable row.
   * - the `CASE` — status period first, then kind, then the default. This is
   *   the precedence rule, and it is one expression so it cannot be applied
   *   inconsistently.
   *
   * `now() - finished_at > interval` uses the database's clock for the
   * comparison but takes `$1` for the reference instant, so a test can sweep
   * with a fixed `now` while production uses real time.
   *
   * ## Deliberately unordered
   *
   * There is no `ORDER BY`, and that is a performance decision rather than an
   * omission. Ordering by `finished_at` would buy nothing — every row matching
   * the predicate is equally eligible, and the batch limit is about bounding
   * cost, not about picking the *oldest* rows first — while costing a great
   * deal: with no index on `finished_at` the planner must scan the whole table
   * and sort every candidate before taking a thousand. Measured at 200 000
   * rows, ordering turned a scan that stops after finding its batch (39 ms)
   * into a full scan plus a 120 000-row external merge sort (152 ms). Unordered,
   * the sweep needs no new index at all; see the note in S2.9 on why one was
   * not created.
   *
   * `RETURNING` gives back the bucket of each deleted row, which is how the log
   * line reports counts per kind and status without a second query.
   */
  private async deleteBatch(
    now: Date,
    limit: number,
  ): Promise<DeletedRow[]> {
    const result: unknown = await this.dataSource.query(
      `DELETE FROM social_ad_sync_runs
        WHERE id IN (
          SELECT id
            FROM social_ad_sync_runs
           WHERE run_kind <> $2
             AND status <> ALL($3::text[])
             AND finished_at IS NOT NULL
             AND $1::timestamptz - finished_at >
                 (COALESCE(
                    ($4::jsonb ->> status)::int,
                    ($5::jsonb ->> run_kind)::int,
                    $6::int
                  ) * interval '1 day')
           FOR UPDATE SKIP LOCKED
           LIMIT $7
        )
        RETURNING run_kind, status`,
      [
        now,
        RETENTION_EXEMPT_RUN_KIND,
        RETENTION_NEVER_DELETED_STATUSES,
        JSON.stringify(RETENTION_DAYS_BY_STATUS),
        JSON.stringify(RETENTION_DAYS_BY_KIND),
        DEFAULT_RETENTION_DAYS,
        limit,
      ],
    );

    return returnedRows<DeletedRow>(result);
  }

  private countByBucket(rows: readonly DeletedRow[]): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const row of rows) {
      const bucket = `${row.run_kind}:${row.status}`;

      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }

    return counts;
  }
}

type DeletedRow = { run_kind: string; status: string };

/**
 * The rows a statement returned, whichever shape the driver used.
 *
 * The same hazard `SocialAdSyncRunService` documents: TypeORM's Postgres driver
 * answers `DELETE ... RETURNING` with `[rows, rowCount]` rather than the row
 * list, and reading the pair as rows would report every sweep as having deleted
 * exactly two rows — including the ones that deleted nothing.
 */
function returnedRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];

  const [first] = result as unknown[];

  return Array.isArray(first) ? (first as T[]) : (result as T[]);
}
