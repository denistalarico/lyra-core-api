import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MediaAssetUploadService } from '../../common/media-assets';
import { CreativeGenerationConfigService } from './creative-generation-config';
import {
  CREATIVE_GENERATION_MEDIA_SOURCE,
  CREATIVE_VIDEO_GENERATION_MEDIA_SOURCE,
} from './creative-retention';

/**
 * A tombstone older than this whose binary is still there belongs to a sweep
 * that failed or died mid-purge; any sweep may claim it again. The claim
 * re-stamps `deleted_at`, so a failing object is retried once per lease,
 * never in a tight loop.
 */
export const CREATIVE_GENERATION_CLEANUP_LEASE = '15 minutes';

/** Bounds one tick: batch size × this many storage calls at most. */
const MAX_BATCHES_PER_TICK = 5;

/** The S3 client has no request timeout; a hung delete must not hang the tick. */
const STORAGE_DELETE_TIMEOUT_MS = 30_000;

export type CreativeGenerationCleanupReason = 'promoted' | 'expired' | 'orphan';

export type CreativeGenerationCleanupResult = {
  mode: 'disabled' | 'dry_run' | 'delete';
  /**
   * Dry run: everything eligible right now. Delete: what this batch
   * tombstoned (newly expired), by reason.
   */
  eligible: Record<CreativeGenerationCleanupReason, number>;
  /** Stale tombstones of an earlier sweep claimed again for purge. */
  retried: number;
  /** Binaries and rows removed. */
  purged: number;
  /** Storage deletes that failed; their tombstones wait for the lease. */
  failed: number;
  /** Claimed but not attempted after a storage failure stopped the batch. */
  deferred: number;
  /** Dry run only: tombstones still waiting for purge. */
  pendingPurge: number;
  hadMore: boolean;
  durationMs: number;
};

const UUID_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

/**
 * No owner other than the generation output holds `m`. Every FK into
 * `media_assets` is `RESTRICT` except the output's own `SET NULL`, and a
 * `RESTRICT` would only fail at the final row delete — after the binary is
 * already gone. So each one is checked BEFORE the tombstone, by name. A
 * temporary asset can never legitimately be in any of them (every write path
 * refuses `temporary:`); this is the second barrier, not the first.
 *
 * Generation references (no FK by design, CS3.4.2) only hold media while
 * their generation is pending; after that the row keeps id + checksum.
 */
const NO_OTHER_OWNER = `
       NOT EXISTS (SELECT 1 FROM social_creative_asset_versions v WHERE v.media_asset_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM social_creative_asset_versions v WHERE v.thumbnail_media_asset_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM social_publications p WHERE p.media_asset_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM social_publication_media pm WHERE pm.media_asset_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM social_destination_creatives d WHERE d.media_asset_id = m.id)
   AND NOT EXISTS (SELECT 1 FROM social_content_references r WHERE r.media_asset_id = m.id)
   AND NOT EXISTS (
         SELECT 1
           FROM social_creative_generation_references gr
           JOIN social_creative_generations pending ON pending.id = gr.generation_id
          WHERE gr.media_asset_id = m.id
            AND pending.status IN ('queued', 'processing'))`;

/**
 * The whole eligibility rule of IMAGE outputs. `$1` source, `$2` cutoff.
 *
 * - temporary generation media, not yet tombstoned;
 * - its generation resolved from the output row (authoritative) or, for an
 *   orphan the worker stored but never linked (lease lost, failed
 *   compensation), from `metadata.generationId` — unresolvable never
 *   qualifies;
 * - that generation is terminal and of the media's exact four-part scope;
 * - promoted (bytes already copied into a version) or older than the cutoff;
 * - no other owner.
 */
const ELIGIBLE = `
  SELECT m.id,
         CASE WHEN o.promoted_version_id IS NOT NULL THEN 'promoted'
              WHEN o.id IS NOT NULL THEN 'expired'
              ELSE 'orphan' END AS reason
    FROM media_assets m
    LEFT JOIN social_creative_generation_outputs o ON o.media_asset_id = m.id
    JOIN social_creative_generations g
      ON g.id = COALESCE(
           o.generation_id,
           CASE WHEN m.metadata ->> 'generationId' ~* '${UUID_PATTERN}'
                THEN (m.metadata ->> 'generationId')::uuid END)
   WHERE m.source = $1
     AND m.deleted_at IS NULL
     AND g.status IN ('completed', 'failed')
     AND g.tenant_id = m.tenant_id
     AND g.workspace_id = m.workspace_id
     AND g.agency_client_id IS NOT DISTINCT FROM m.agency_client_id
     AND g.company_context_id IS NOT DISTINCT FROM m.company_context_id
     AND (o.promoted_version_id IS NOT NULL OR m.created_at < $2)
     AND ${NO_OTHER_OWNER}`;

/**
 * CS4-B — the same rule for generated REELS (video and its poster). The
 * generation row is the authoritative link (`output_media_asset_id` /
 * `poster_media_asset_id`); `metadata.videoGenerationId` only finds an
 * orphan the worker stored but never linked. Terminal generation of the same
 * four-part scope, promoted (bytes copied) or past the cutoff, no other owner.
 */
const VIDEO_ELIGIBLE = `
  SELECT m.id,
         CASE WHEN linked.id IS NULL THEN 'orphan'
              WHEN g.promoted_version_id IS NOT NULL THEN 'promoted'
              ELSE 'expired' END AS reason
    FROM media_assets m
    LEFT JOIN social_creative_video_generations linked
      ON linked.output_media_asset_id = m.id OR linked.poster_media_asset_id = m.id
    JOIN social_creative_video_generations g
      ON g.id = COALESCE(
           linked.id,
           CASE WHEN m.metadata ->> 'videoGenerationId' ~* '${UUID_PATTERN}'
                THEN (m.metadata ->> 'videoGenerationId')::uuid END)
   WHERE m.source = $1
     AND m.deleted_at IS NULL
     AND g.status IN ('completed', 'failed')
     AND g.tenant_id = m.tenant_id
     AND g.workspace_id = m.workspace_id
     AND g.agency_client_id IS NOT DISTINCT FROM m.agency_client_id
     AND g.company_context_id IS NOT DISTINCT FROM m.company_context_id
     AND (g.promoted_version_id IS NOT NULL OR m.created_at < $2)
     AND ${NO_OTHER_OWNER}`;

/**
 * Temporary media families this worker expires. Same lifecycle, same
 * retention knob; each with its own source and its own owner link.
 */
const FAMILIES = [
  { source: CREATIVE_GENERATION_MEDIA_SOURCE, eligible: ELIGIBLE },
  { source: CREATIVE_VIDEO_GENERATION_MEDIA_SOURCE, eligible: VIDEO_ELIGIBLE },
] as const;
const SOURCES = FAMILIES.map((family) => family.source);
type Claimed = { id: string; source: string };

/** `DataSource.query` answers `[rows, rowCount]` for UPDATE … RETURNING (S2.5 lesson). */
function returnedRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  if (result.length === 2 && Array.isArray(result[0])) return result[0] as T[];
  return result as T[];
}

function emptyReasons(): Record<CreativeGenerationCleanupReason, number> {
  return { promoted: 0, expired: 0, orphan: 0 };
}

/**
 * CS3.6.1 — expires the binaries of temporary generation outputs.
 *
 *   temporary_generation → retention → eligible → tombstone → object → row
 *
 * Provenance is never touched: generations, outputs (with their promotion
 * link), references, usage and errors stay. Deleting the media row lets the
 * FK set `outputs.media_asset_id` to NULL — "there was an output here, its
 * binary expired" — and the API already answers that as `available: false`
 * and 410 on content.
 *
 * ORDER OF OPERATIONS
 * -------------------
 * 1. Claim (one statement, `FOR UPDATE SKIP LOCKED`): eligible rows get
 *    `deleted_at = now()`. From this commit on the asset is invisible to every
 *    read and nothing can attach to it. Stale tombstones of a failed earlier
 *    sweep are re-claimed the same way.
 * 2. Purge each claimed row through the media boundary: object first, then
 *    the row. A storage failure leaves the tombstone (which still records the
 *    key) for a later sweep; a row-delete failure leaves an invisible
 *    tombstone whose retry converges, because deleting a missing key succeeds.
 *
 * No transaction is held during storage I/O. Two sweeps never claim the same
 * row (SKIP LOCKED + the tombstone itself); if a lease expires under a slow
 * purge, the overlap is two idempotent deletes, and only one row delete
 * counts.
 *
 * Separation from the API needs no code: a process with
 * `CREATIVE_GENERATION_CLEANUP_ENABLED` unset never sweeps.
 */
@Injectable()
export class CreativeGenerationCleanupWorker {
  private readonly logger = new Logger(CreativeGenerationCleanupWorker.name);
  private running = false;

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly mediaUpload: MediaAssetUploadService,
    private readonly config: CreativeGenerationConfigService,
  ) {}

  /** Hourly, off the top of the hour where most other crons fire. */
  @Cron('17 * * * *')
  async tick(): Promise<void> {
    if (!this.config.cleanupEnabled || this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (error) {
      // Housekeeping never takes the process down. Name only: a driver
      // error's message can carry statement fragments.
      this.logger.error(
        `creative generation cleanup failed: ${(error as Error)?.name ?? typeof error}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Dry run: one read-only report. Delete: batches until the backlog is
   * drained, the tick's budget is spent, or storage fails.
   */
  async run(now?: Date): Promise<CreativeGenerationCleanupResult[]> {
    if (!this.config.cleanupEnabled) return [];
    if (this.config.cleanupDryRun) return [await this.sweep(now)];
    const results: CreativeGenerationCleanupResult[] = [];
    for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch += 1) {
      const result = await this.sweep(now);
      results.push(result);
      if (!result.hadMore || result.failed > 0) break;
    }
    return results;
  }

  /** One batch (or, in dry run, one report). `now` is injectable for tests. */
  async sweep(now = new Date()): Promise<CreativeGenerationCleanupResult> {
    const started = Date.now();
    const result: CreativeGenerationCleanupResult = {
      mode: 'disabled',
      eligible: emptyReasons(),
      retried: 0,
      purged: 0,
      failed: 0,
      deferred: 0,
      pendingPurge: 0,
      hadMore: false,
      durationMs: 0,
    };
    if (!this.config.cleanupEnabled) return result;

    const cutoff = new Date(
      now.getTime() - this.config.tempRetentionDays * 86_400_000,
    );
    if (this.config.cleanupDryRun) {
      result.mode = 'dry_run';
      await this.report(cutoff, result);
      result.durationMs = Date.now() - started;
      this.logger.log(
        `creative generation cleanup dry run: ${JSON.stringify(this.summary(result))}`,
      );
      return result;
    }

    result.mode = 'delete';
    const limit = this.config.cleanupBatchSize;
    const retried = await this.reclaimStale(limit);
    const fresh: (Claimed & { reason: CreativeGenerationCleanupReason })[] = [];
    for (const family of FAMILIES) {
      const room = limit - retried.length - fresh.length;
      if (room <= 0) break;
      for (const row of await this.tombstone(family, cutoff, room))
        fresh.push({ ...row, source: family.source });
    }
    result.retried = retried.length;
    for (const row of fresh) result.eligible[row.reason] += 1;
    result.hadMore = retried.length + fresh.length >= limit;

    const claimed: Claimed[] = [...retried, ...fresh];
    for (const [index, { id, source }] of claimed.entries()) {
      try {
        if (await this.purge(id, source)) result.purged += 1;
      } catch (error) {
        // Storage is most likely down: stop here instead of failing the rest
        // one by one. Every claimed row stays tombstoned for a later sweep.
        result.failed += 1;
        result.deferred = claimed.length - index - 1;
        this.logger.warn(
          `creative generation cleanup: storage delete failed media=${id} error=${(error as Error)?.name ?? typeof error} deferred=${result.deferred}`,
        );
        break;
      }
    }
    result.durationMs = Date.now() - started;
    // Quiet when idle: an hourly "nothing to do" is how logs stop being read.
    if (claimed.length > 0)
      this.logger.log(
        `creative generation cleanup batch: ${JSON.stringify(this.summary(result))}`,
      );
    return result;
  }

  private async tombstone(
    family: (typeof FAMILIES)[number],
    cutoff: Date,
    limit: number,
  ) {
    return returnedRows<{
      id: string;
      reason: CreativeGenerationCleanupReason;
    }>(
      await this.dataSource.query(
        `UPDATE media_assets AS target
            SET deleted_at = now()
           FROM (
             ${family.eligible}
              ORDER BY m.created_at, m.id
              LIMIT $3
              FOR UPDATE OF m SKIP LOCKED
           ) AS claimed
          WHERE target.id = claimed.id
          RETURNING target.id, claimed.reason`,
        [family.source, cutoff, limit],
      ),
    );
  }

  private async reclaimStale(limit: number): Promise<Claimed[]> {
    return returnedRows<Claimed>(
      await this.dataSource.query(
        `UPDATE media_assets AS target
            SET deleted_at = now()
           FROM (
             SELECT m.id
               FROM media_assets m
              WHERE m.source = ANY($1::varchar[])
                AND m.deleted_at < now() - interval '${CREATIVE_GENERATION_CLEANUP_LEASE}'
                AND ${NO_OTHER_OWNER}
              ORDER BY m.deleted_at, m.id
              LIMIT $2
              FOR UPDATE OF m SKIP LOCKED
           ) AS claimed
          WHERE target.id = claimed.id
          RETURNING target.id, target.source`,
        [SOURCES, limit],
      ),
    );
  }

  /** Read-only: no lock, no write, no storage call. */
  private async report(cutoff: Date, result: CreativeGenerationCleanupResult) {
    for (const family of FAMILIES) {
      const rows = await this.dataSource.query<
        { reason: CreativeGenerationCleanupReason; count: number }[]
      >(
        `SELECT eligible.reason, count(*)::int AS count
           FROM (${family.eligible}) AS eligible
          GROUP BY eligible.reason`,
        [family.source, cutoff],
      );
      for (const row of rows) result.eligible[row.reason] += row.count;
    }
    const [pending] = await this.dataSource.query<{ count: number }[]>(
      `SELECT count(*)::int AS count
         FROM media_assets
        WHERE source = ANY($1::varchar[]) AND deleted_at IS NOT NULL`,
      [SOURCES],
    );
    result.pendingPurge = pending?.count ?? 0;
  }

  private purge(mediaAssetId: string, source: string): Promise<boolean> {
    const purge = this.mediaUpload.purgeTombstonedTemporary(
      mediaAssetId,
      source,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new StorageDeleteTimeoutError()),
        STORAGE_DELETE_TIMEOUT_MS,
      );
    });
    // A purge that settles after the timeout must not surface as unhandled.
    purge.catch(() => undefined);
    return Promise.race([purge, timeout]).finally(() => clearTimeout(timer));
  }

  /** Counts, mode and duration only — no ids, keys, prompts or scope. */
  private summary(result: CreativeGenerationCleanupResult) {
    const { mode, eligible, retried, purged, failed, deferred, durationMs } =
      result;
    return {
      mode,
      eligible,
      retried,
      purged,
      failed,
      deferred,
      ...(mode === 'dry_run' ? { pendingPurge: result.pendingPurge } : {}),
      hadMore: result.hadMore,
      durationMs,
    };
  }
}

class StorageDeleteTimeoutError extends Error {
  override name = 'StorageDeleteTimeoutError';
}
