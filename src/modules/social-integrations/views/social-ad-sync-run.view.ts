import type { SocialAdSyncRunEntity } from '../entities/social-ad-sync-run.entity';
import type { SocialAdSyncRunStatus } from '../entities/social-ad-sync-run.entity';
import type {
  SocialAdSyncFailedSegment,
  SocialAdSyncRunKind,
  SocialAdSyncSegment,
} from '../sync/social-ad-sync-run.contract';
import { SYNC_SEGMENTS_BY_KIND } from '../sync/social-ad-sync-run.contract';

/**
 * A run as anybody outside this module may see it.
 *
 * Built field by field from the entity, never by spreading it. The run row
 * carries three things that must not travel: `locked_by`, which names a host
 * and a process id and is a map of the deployment; `cursor_state`, which is
 * reserved for provider paging position and would carry provider payload the
 * day it is used; and the scope columns, which tell a caller nothing it did not
 * already supply. A spread would carry all three the moment a column is added.
 */
export type SocialAdSyncRunView = {
  id: string;
  connectionId: string;
  /**
   * `run_kind` as stored — a plain string, not the union.
   *
   * The column is unconstrained, so a row written by an older or newer build
   * can hold a kind this code does not know. Typing it as the union here would
   * promise a value the database does not guarantee.
   */
  kind: string;
  status: SocialAdSyncRunStatus;
  /** Inclusive calendar window, or null for a run with no date dimension. */
  since: string | null;
  until: string | null;
  segments: readonly SocialAdSyncSegment[];
  attempts: number;
  maxAttempts: number;
  rowsWritten: number;
  rowsSkipped: number;
  entitiesWritten: number;
  apiCalls: number;
  /** Safe code, already sanitized where it was recorded. */
  error: string | null;
  failedSegments: SocialAdSyncFailedSegment[];
  availableAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export function toSocialAdSyncRunView(
  run: SocialAdSyncRunEntity,
): SocialAdSyncRunView {
  return {
    id: run.id,
    connectionId: run.connectionId,
    kind: run.runKind,
    status: run.status,
    since: readDay(run.windowStart),
    until: readDay(run.windowEnd),
    segments: SYNC_SEGMENTS_BY_KIND[run.runKind as SocialAdSyncRunKind] ?? [],
    attempts: run.attempts,
    maxAttempts: run.maxAttempts,
    rowsWritten: run.rowsWritten,
    rowsSkipped: run.rowsSkipped,
    entitiesWritten: run.entitiesWritten,
    apiCalls: run.apiCalls,
    error: run.lastError,
    failedSegments: readFailedSegments(run.failedSegments),
    availableAt: run.availableAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
  };
}

/**
 * A `date` column comes back as a string from Postgres and as a `Date` from an
 * entity that was just saved in memory. Both have to answer the same way, and
 * the string form is the one that carries no timezone to apply twice.
 */
function readDay(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;

  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value);
}

/**
 * Re-reads the stored segments rather than passing the column through.
 *
 * `failed_segments` is `jsonb`, so its contents are whatever was written — and
 * this view is the boundary where that stops being true. Only the two known
 * fields survive, and only when they are the right shape: anything a future
 * writer adds, and anything an older row happens to hold, is dropped here
 * instead of being handed to a caller because it was in the column.
 */
function readFailedSegments(value: unknown): SocialAdSyncFailedSegment[] {
  if (!Array.isArray(value)) return [];

  const segments: SocialAdSyncFailedSegment[] = [];

  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null) continue;

    const entry = candidate as Record<string, unknown>;

    if (typeof entry.segment !== 'string') continue;
    if (typeof entry.errorCode !== 'string') continue;

    segments.push({
      segment: entry.segment as SocialAdSyncSegment,
      errorCode: entry.errorCode,
    });
  }

  return segments;
}
