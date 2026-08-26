import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SocialAdEntityLevel } from './social-ad-entity.entity';

/**
 * Lifecycle of one sync attempt.
 *
 * `partial` is the state that earns its place: an insights window can succeed
 * for three of four ad sets and hit a rate limit on the fourth, and calling
 * that `failed` throws away work while calling it `succeeded` hides a hole.
 * `dead_letter` is terminal-after-retries, kept distinct from `failed` so a
 * human can tell "gave up" from "will try again".
 */
export type SocialAdSyncRunStatus =
  | 'queued'
  | 'processing'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'dead_letter'
  | 'cancelled';

/**
 * The queue and the log of the Meta Ads read pipeline — the same table on
 * purpose. A queue that discards its rows on completion cannot answer "why is
 * yesterday missing?", which is the only question anyone asks about a sync.
 *
 * **No worker exists yet.** This slice creates the schema the worker will
 * claim rows from; nothing enqueues, locks or executes a run today. The
 * columns that look like a leasing protocol (`available_at`, `locked_at`,
 * `locked_by`, `attempts`) are here because the claiming query and its indexes
 * have to be designed together with the table, not bolted on once rows exist.
 */
@Entity('social_ad_sync_runs')
/**
 * One live run per connection per intent.
 *
 * Partial on the two active states so the constraint binds exactly where it
 * matters: a second enqueue of the same window while one is still in flight is
 * a duplicate, and the same key a week later is a legitimate re-run.
 */
@Index('UQ_social_ad_sync_runs_inflight', ['connectionId', 'idempotencyKey'], {
  unique: true,
  where: `"status" IN ('queued', 'processing')`,
})
// The claiming query: the queue only ever looks at what is due and queued.
@Index('IDX_social_ad_sync_runs_queue', ['availableAt'], {
  where: `"status" = 'queued'`,
})
// Runs whose worker died holding the lease. Without this the recovery sweep
// scans the whole history to find a handful of rows.
@Index('IDX_social_ad_sync_runs_stale_lock', ['lockedAt'], {
  where: `"status" = 'processing'`,
})
@Index('IDX_social_ad_sync_runs_connection', ['connectionId', 'createdAt'])
@Check(
  'CK_social_ad_sync_runs_status',
  `"status" IN ('queued', 'processing', 'succeeded', 'partial', 'failed', 'dead_letter', 'cancelled')`,
)
// Tolerates NULLs on both sides: a hierarchy sync has no date window at all,
// and only an inverted pair is actually wrong.
@Check(
  'CK_social_ad_sync_runs_window',
  `"window_start" IS NULL OR "window_end" IS NULL OR "window_start" <= "window_end"`,
)
export class SocialAdSyncRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  /**
   * What the run is for — hierarchy, insights, a backfill.
   *
   * Left as an unconstrained string, unlike `status`: the vocabulary belongs
   * to the worker that does not exist yet, and inventing its values here would
   * pin a design decision this slice has no evidence for.
   */
  @Column({ name: 'run_kind', type: 'varchar', length: 40 })
  runKind!: string;

  @Column({ type: 'varchar', length: 24, default: 'queued' })
  status!: SocialAdSyncRunStatus;

  /**
   * Inclusive calendar-day window, matching `metric_date` and Meta's
   * `time_range`. NULL for runs that have no date dimension.
   */
  @Column({ name: 'window_start', type: 'date', nullable: true })
  windowStart!: string | null;

  @Column({ name: 'window_end', type: 'date', nullable: true })
  windowEnd!: string | null;

  /** Levels this run covers, e.g. `["campaign","adset"]`. */
  @Column({
    name: 'entity_levels',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  entityLevels!: SocialAdEntityLevel[];

  /**
   * Caller-supplied identity of the intent, not of the row. It is what the
   * in-flight unique index compares, so a retrying scheduler and a user
   * hitting "sync now" twice collapse into one run instead of two readers
   * racing over the same window.
   */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 200 })
  idempotencyKey!: string;

  /** NULL for a scheduled run; set when a person asked for it. */
  @Column({ name: 'requested_by_id', type: 'uuid', nullable: true })
  requestedById!: string | null;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 5 })
  maxAttempts!: number;

  /**
   * Not before this instant. It is the whole backoff mechanism: a rate-limited
   * run is rescheduled by pushing this out, which is also how Meta's own
   * `Retry-After` gets honoured without a sleeping process.
   */
  @Column({ name: 'available_at', type: 'timestamptz', default: () => 'now()' })
  availableAt!: Date;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  /** Identifier of the process holding the lease, for recovering after a crash. */
  @Column({ name: 'locked_by', type: 'varchar', length: 120, nullable: true })
  lockedBy!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt!: Date | null;

  @Column({ name: 'rows_written', type: 'integer', default: 0 })
  rowsWritten!: number;

  @Column({ name: 'rows_skipped', type: 'integer', default: 0 })
  rowsSkipped!: number;

  @Column({ name: 'entities_written', type: 'integer', default: 0 })
  entitiesWritten!: number;

  /**
   * Requests spent. The Marketing API bills against a shared business quota, so
   * this is how a run that quietly costs ten times its neighbours becomes
   * visible before it starves the others.
   */
  @Column({ name: 'api_calls', type: 'integer', default: 0 })
  apiCalls!: number;

  /**
   * A safe code, never a provider message. Meta's error strings carry account
   * ids and occasionally fragments of the request, and this column is read
   * back into the settings UI.
   */
  @Column({ name: 'last_error', type: 'varchar', length: 240, nullable: true })
  lastError!: string | null;

  /**
   * The parts that did not land, which is what makes `partial` actionable: a
   * retry can re-read three ad sets instead of the whole window.
   */
  @Column({
    name: 'failed_segments',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  failedSegments!: unknown[];

  /**
   * Provider paging position, so an interrupted run resumes instead of paying
   * for the pages it already read.
   */
  @Column({ name: 'cursor_state', type: 'jsonb', default: () => "'{}'::jsonb" })
  cursorState!: Record<string, unknown>;

  /**
   * When this log row stops being useful. The column exists so the retention
   * policy has somewhere to write; no sweeper reads it yet, and it is
   * deliberately left unindexed until one does — an index that serves a
   * process nobody has written is write amplification on every run.
   */
  @Column({ name: 'retain_until', type: 'timestamptz', nullable: true })
  retainUntil!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
