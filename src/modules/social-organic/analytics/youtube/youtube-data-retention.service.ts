import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { FilesService } from '../../../../common/files/files.service';
import { YOUTUBE_PROVIDER } from '../../providers/youtube/youtube-capabilities';

export const SOCIAL_YOUTUBE_DATA_RETENTION_ENABLED_ENV =
  'SOCIAL_YOUTUBE_DATA_RETENTION_ENABLED';

/**
 * YouTube API Services Developer Policies:
 * - III.D.2.3 Revocation: Authorized Data goes within 7 days of a revocation
 *   through Lyra and within 30 days of one at Google; tokens must be
 *   reconfirmed periodically, and data of tokens that cannot be refreshed goes.
 * - III.E.4: statistics and Analytics data may stay while the authorization is
 *   re-verified (at least every 30 days, including that each video still
 *   exists); other Authorized Data (titles, channel name, handle, avatar) is
 *   refreshed or deleted within 30 days.
 *
 * `YoutubeOrganicHealthService` reconfirms every live channel daily and stamps
 * `metadata.youtubeConfirmedAt`. Google never says when a user revoked access,
 * so the last successful confirmation, which precedes the revocation, starts
 * the clock: the deadlines below are measured from before the revocation.
 */
export const YOUTUBE_REAUTH_GRACE_DAYS = 20;
/** A connected channel whose checks keep failing definitively. */
export const YOUTUBE_UNVERIFIED_GRACE_DAYS = 25;
/** Data API fields (titles, publish times, channel name/handle/avatar). */
export const YOUTUBE_DETAIL_MAX_AGE_DAYS = 30;

const LOCK_KEY = 'social_youtube_data_retention';
const DAY_MS = 86_400_000;

/** Tables the YouTube provider writes, keyed by the channel asset. */
const YOUTUBE_ASSET_DATA_TABLES = [
  'social_organic_post_metrics_daily',
  'social_organic_account_metrics_daily',
] as const;
/** Report and dashboard sections that can show YouTube numbers. */
const YOUTUBE_REPORT_CHANNELS = ['youtube', 'summary'] as const;

/** A timestamp in the asset's metadata, read defensively (bad value = null). */
const metadataTimeSql = (key: string) =>
  `CASE WHEN a.metadata->>'${key}' ~ '^\\d{4}-\\d{2}-\\d{2}T'
     THEN (a.metadata->>'${key}')::timestamptz END`;
/** Grant and channel reconfirmed by the daily health check. */
const CONFIRMED_AT_SQL = metadataTimeSql('youtubeConfirmedAt');
/** Every stored video re-read by the daily health check. */
const VIDEOS_VERIFIED_AT_SQL = metadataTimeSql('youtubeVideosVerifiedAt');

export type YoutubePurgeReason =
  | 'disconnected'
  | 'reauth_expired'
  | 'unverified';

export type YoutubeRetentionCandidate = {
  assetId: string;
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId: string | null;
  assetCreatedAt: Date;
  organicActive: boolean;
  healthStatus: string | null;
  confirmedAt: Date | null;
  authorizationId: string | null;
  authorizationStatus: string | null;
  reauthSince: Date | null;
};

export type YoutubeRetentionResult = {
  purgedAssets: number;
  deletedRows: number;
  staleDetailRows: number;
  staleChannelRows: number;
};

type Queryable = Pick<EntityManager, 'query'>;

export function youtubeDataRetentionEnabled(): boolean {
  // On unless explicitly braked: deletion is a policy obligation, not a feature.
  return (
    process.env[
      SOCIAL_YOUTUBE_DATA_RETENTION_ENABLED_ENV
    ]?.trim().toLowerCase() !== 'false'
  );
}

const elapsed = (from: Date | null, now: Date, days: number) =>
  from !== null && now.getTime() - from.getTime() >= days * DAY_MS;

/**
 * Why an asset's YouTube data must go now, or null while it may stay. Live =
 * the channel is active in Lyra and backed by a connected Google YouTube link.
 */
export function youtubePurgeReason(
  candidate: Pick<
    YoutubeRetentionCandidate,
    | 'organicActive'
    | 'authorizationId'
    | 'authorizationStatus'
    | 'reauthSince'
    | 'confirmedAt'
  >,
  now: Date,
): YoutubePurgeReason | null {
  if (!candidate.organicActive || !candidate.authorizationId)
    return 'disconnected';
  if (candidate.authorizationStatus !== 'connected') {
    // `reauth_required`: tokens are gone. Counted from the earliest known
    // moment: the last confirmation, else when the refresh was refused.
    const known = [candidate.confirmedAt, candidate.reauthSince].filter(
      (date): date is Date => date !== null,
    );
    const since = known.length
      ? new Date(Math.min(...known.map((date) => date.getTime())))
      : null;
    return elapsed(since, now, YOUTUBE_REAUTH_GRACE_DAYS)
      ? 'reauth_expired'
      : null;
  }
  // Connected, but no daily check has confirmed it for weeks (channel no
  // longer reachable, scopes lost, persistent failures): it cannot be
  // re-verified. Never applies before the first confirmation stamp.
  return elapsed(candidate.confirmedAt, now, YOUTUBE_UNVERIFIED_GRACE_DAYS)
    ? 'unverified'
    : null;
}

/**
 * Writes the current title and publish time to every stored row of each video
 * just read from `videos.list`; a video it no longer returns (deleted or
 * private) loses them. Shared by the sync and the daily health check.
 */
export async function refreshYoutubeVideoDetails(
  db: Queryable,
  assetId: string,
  videoIds: readonly string[],
  details: ReadonlyMap<
    string,
    { title: string | null; publishedAt: Date | null }
  >,
): Promise<void> {
  if (videoIds.length === 0) return;
  await db.query(
    `UPDATE social_organic_post_metrics_daily p
        SET caption = d.title, published_at = d.published_at
       FROM unnest($2::text[], $3::text[], $4::timestamptz[])
              AS d(video_id, title, published_at)
      WHERE p.asset_id = $1 AND p.external_publication_id = d.video_id
        AND (p.caption IS DISTINCT FROM d.title
             OR p.published_at IS DISTINCT FROM d.published_at)`,
    [
      assetId,
      videoIds,
      videoIds.map((id) => details.get(id)?.title ?? null),
      videoIds.map((id) => details.get(id)?.publishedAt ?? null),
    ],
  );
}

/**
 * Deletes stored YouTube API data that Lyra may no longer keep, for one channel
 * at a time:
 * - daily metrics of the channel and its videos;
 * - the channel's name, handle and avatar on its asset row;
 * - PDF reports emitted in the channel's context that include YouTube or the
 *   cross-channel summary (file and row), and frozen AI insight cards in those
 *   dashboard sections.
 * The asset row and Lyra's own publication records stay: they hold what the
 * user wrote and the id of the user's own upload, not data read from the API.
 * Each purge leaves a `youtube_data_purged` audit event. Idempotent.
 */
@Injectable()
export class YoutubeDataRetentionService {
  private readonly logger = new Logger(YoutubeDataRetentionService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    @Optional() private readonly files?: FilesService,
  ) {}

  async sweep(now: Date = new Date()): Promise<YoutubeRetentionResult | null> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [{ locked }] = (await runner.query(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
        [LOCK_KEY],
      )) as Array<{ locked: boolean }>;
      if (!locked) return null;
      try {
        return await this.run(now);
      } finally {
        await runner.query(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
          [LOCK_KEY],
        );
      }
    } finally {
      await runner.release();
    }
  }

  async run(now: Date): Promise<YoutubeRetentionResult> {
    const result: YoutubeRetentionResult = {
      purgedAssets: 0,
      deletedRows: 0,
      staleDetailRows: 0,
      staleChannelRows: 0,
    };
    for (const candidate of await this.candidates(this.dataSource.manager)) {
      if (!youtubePurgeReason(candidate, now)) continue;
      try {
        const deleted = await this.purgeAsset(candidate.assetId, now);
        if (deleted === null) continue;
        result.purgedAssets += 1;
        result.deletedRows += deleted;
      } catch (error) {
        this.logger.warn(
          `YouTube data purge failed for asset ${candidate.assetId} (${error instanceof Error ? error.name : 'unknown'}).`,
        );
      }
    }
    result.staleDetailRows = await this.expireStaleDetails(now);
    result.staleChannelRows = await this.expireStaleChannelDetails(now);
    if (
      result.purgedAssets > 0 ||
      result.staleDetailRows > 0 ||
      result.staleChannelRows > 0
    ) {
      this.logger.log(
        `YouTube data retention: ${result.purgedAssets} channel(s) purged, ${result.deletedRows} metric row(s) deleted, ${result.staleDetailRows} stale video detail row(s) and ${result.staleChannelRows} stale channel detail row(s) cleared.`,
      );
    }
    return result;
  }

  /**
   * Purges one asset when a rule applies, re-deciding under its row lock so a
   * reconnection that commits first wins. Returns metric rows deleted, or null
   * when nothing applies.
   */
  async purgeAsset(assetId: string, now: Date): Promise<number | null> {
    const [preview] = await this.candidates(this.dataSource.manager, assetId);
    if (!preview || !youtubePurgeReason(preview, now)) return null;

    // Report files first, outside the transaction: a failure aborts the purge
    // and the next run retries it (deleting a missing object succeeds).
    const reports = await this.reportsOf(this.dataSource.manager, preview);
    for (const report of reports) {
      if (!report.storageKey) continue;
      if (!this.files) throw new Error('files_service_unavailable');
      await this.files.deleteObject({
        bucket: 'private',
        path: report.storageKey,
      });
    }

    return this.dataSource.transaction(async (manager) => {
      const [candidate] = await this.candidates(manager, assetId, true);
      const reason = candidate ? youtubePurgeReason(candidate, now) : null;
      if (!candidate || !reason) return null;

      let deleted = 0;
      for (const table of YOUTUBE_ASSET_DATA_TABLES) {
        const [, count] = await manager.query<[unknown, number | null]>(
          `DELETE FROM ${table} WHERE asset_id = $1`,
          [assetId],
        );
        deleted += count ?? 0;
      }
      await manager.query(
        `UPDATE social_organic_assets
            SET display_name = NULL, username = NULL, avatar_url = NULL,
                capabilities_snapshot = '{}'::jsonb, metadata = '{}'::jsonb,
                updated_at = now()
          WHERE id = $1`,
        [assetId],
      );
      if (reports.length) {
        await manager.query(
          `DELETE FROM social_analytics_reports WHERE id = ANY($1::uuid[])`,
          [reports.map((report) => report.id)],
        );
      }
      await this.dropFrozenInsights(manager, candidate);
      await manager.query(
        `INSERT INTO social_google_audit_events
           (tenant_id, authorization_id, event, product, actor_id, detail)
         VALUES ($1, $2, 'youtube_data_purged', 'youtube', NULL, $3)`,
        [
          candidate.tenantId,
          candidate.authorizationId,
          `${reason}:asset=${assetId}`.slice(0, 64),
        ],
      );
      return deleted;
    });
  }

  /**
   * Clears video titles and publish times nobody refreshed for
   * YOUTUBE_DETAIL_MAX_AGE_DAYS: neither the sync (per video) nor the daily
   * health check (the whole channel). Metrics are Analytics data and stay.
   */
  async expireStaleDetails(now: Date): Promise<number> {
    const cutoff = new Date(
      now.getTime() - YOUTUBE_DETAIL_MAX_AGE_DAYS * DAY_MS,
    );
    const [, count] = await this.dataSource.query<[unknown, number | null]>(
      `UPDATE social_organic_post_metrics_daily p
          SET caption = NULL, published_at = NULL
         FROM social_organic_assets a
        WHERE a.id = p.asset_id AND a.provider = $1
          AND (p.caption IS NOT NULL OR p.published_at IS NOT NULL)
          AND COALESCE(${VIDEOS_VERIFIED_AT_SQL}, '-infinity') < $2
          AND NOT EXISTS (
            SELECT 1 FROM social_organic_post_metrics_daily f
             WHERE f.asset_id = p.asset_id
               AND f.external_publication_id = p.external_publication_id
               AND f.synced_at >= $2)`,
      [YOUTUBE_PROVIDER, cutoff],
    );
    return count ?? 0;
  }

  /**
   * Clears the channel name, handle and avatar of a channel the health check
   * has not refreshed for YOUTUBE_DETAIL_MAX_AGE_DAYS (before the first check,
   * the selection time, i.e. the row's last update, counts).
   */
  async expireStaleChannelDetails(now: Date): Promise<number> {
    const cutoff = new Date(
      now.getTime() - YOUTUBE_DETAIL_MAX_AGE_DAYS * DAY_MS,
    );
    const [, count] = await this.dataSource.query<[unknown, number | null]>(
      `UPDATE social_organic_assets a
          SET display_name = NULL, username = NULL, avatar_url = NULL,
              updated_at = now()
        WHERE a.provider = $1
          AND (a.display_name IS NOT NULL OR a.username IS NOT NULL
               OR a.avatar_url IS NOT NULL)
          AND COALESCE(${CONFIRMED_AT_SQL}, a.updated_at) < $2`,
      [YOUTUBE_PROVIDER, cutoff],
    );
    return count ?? 0;
  }

  /** Reports of the channel's context, emitted while it existed. */
  private reportsOf(db: Queryable, candidate: YoutubeRetentionCandidate) {
    return db.query<Array<{ id: string; storageKey: string | null }>>(
      `SELECT r.id, r.storage_key AS "storageKey"
         FROM social_analytics_reports r
        WHERE r.tenant_id = $1 AND r.workspace_id = $2
          AND r.agency_client_id IS NOT DISTINCT FROM $3::uuid
          AND r.company_context_id IS NOT DISTINCT FROM $4::uuid
          AND r.channels ?| $5::text[]
          AND r.created_at >= $6`,
      [
        candidate.tenantId,
        candidate.workspaceId,
        candidate.agencyClientId,
        candidate.companyContextId,
        [...YOUTUBE_REPORT_CHANNELS],
        candidate.assetCreatedAt,
      ],
    );
  }

  /** Removes AI insight cards (frozen readings of the numbers) from the
   * YouTube and summary sections of the context's dashboards. */
  private async dropFrozenInsights(
    manager: EntityManager,
    candidate: YoutubeRetentionCandidate,
  ) {
    await manager.query(
      `UPDATE social_analytics_dashboards d
          SET layout = jsonb_set(d.layout, '{sections}', (
            SELECT COALESCE(jsonb_agg(
                     CASE WHEN s.section->>'channel' = ANY($5::text[])
                            AND jsonb_typeof(s.section->'cards') = 'array'
                       THEN jsonb_set(s.section, '{cards}', COALESCE((
                         SELECT jsonb_agg(c.card ORDER BY c.ord)
                           FROM jsonb_array_elements(s.section->'cards')
                                WITH ORDINALITY AS c(card, ord)
                          WHERE c.card->>'kind' IS DISTINCT FROM 'insight'),
                         '[]'::jsonb))
                       ELSE s.section END
                     ORDER BY s.ord), '[]'::jsonb)
              FROM jsonb_array_elements(d.layout->'sections')
                   WITH ORDINALITY AS s(section, ord)))
        WHERE d.tenant_id = $1 AND d.workspace_id = $2
          AND d.agency_client_id IS NOT DISTINCT FROM $3::uuid
          AND d.company_context_id IS NOT DISTINCT FROM $4::uuid
          AND jsonb_typeof(d.layout->'sections') = 'array'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(d.layout->'sections') s
             WHERE s->>'channel' = ANY($5::text[])
               AND jsonb_typeof(s->'cards') = 'array'
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(s->'cards') c
                            WHERE c->>'kind' = 'insight'))`,
      [
        candidate.tenantId,
        candidate.workspaceId,
        candidate.agencyClientId,
        candidate.companyContextId,
        [...YOUTUBE_REPORT_CHANNELS],
      ],
    );
  }

  /** YouTube assets still holding API data, with their liveness inputs. */
  private async candidates(
    db: Queryable,
    assetId?: string,
    lock = false,
  ): Promise<YoutubeRetentionCandidate[]> {
    const rows = await db.query<
      Array<
        Omit<
          YoutubeRetentionCandidate,
          'assetCreatedAt' | 'confirmedAt' | 'reauthSince'
        > & {
          assetCreatedAt: Date | string;
          confirmedAt: Date | string | null;
          reauthSince: Date | string | null;
        }
      >
    >(
      `SELECT a.id AS "assetId", a.tenant_id AS "tenantId",
              a.workspace_id AS "workspaceId",
              a.agency_client_id AS "agencyClientId",
              a.company_context_id AS "companyContextId",
              a.created_at AS "assetCreatedAt",
              (a.status = 'active' AND c.connection_status = 'connected'
                 AND c.credential_removed_at IS NULL) AS "organicActive",
              a.last_health_status AS "healthStatus",
              ${CONFIRMED_AT_SQL} AS "confirmedAt",
              g.id AS "authorizationId", g.status AS "authorizationStatus",
              CASE WHEN g.status = 'reauth_required' THEN COALESCE(
                (SELECT max(e.created_at) FROM social_google_audit_events e
                  WHERE e.authorization_id = g.id AND e.event = 'reauth_required'),
                g.updated_at) END AS "reauthSince"
         FROM social_organic_assets a
         JOIN social_organic_connections c ON c.id = a.connection_id
         LEFT JOIN LATERAL (
           SELECT auth.id, auth.status, auth.updated_at
             FROM social_google_authorizations auth
             JOIN social_google_product_links l
               ON l.authorization_id = auth.id AND l.product = 'youtube'
              AND l.status = 'connected'
            WHERE auth.tenant_id = a.tenant_id
              AND auth.workspace_id = a.workspace_id
              AND auth.agency_client_id IS NOT DISTINCT FROM a.agency_client_id
              AND auth.company_context_id IS NOT DISTINCT FROM a.company_context_id
              AND auth.status <> 'revoked'
            ORDER BY (auth.status = 'connected') DESC, auth.updated_at DESC
            LIMIT 1
         ) g ON true
        WHERE a.provider = $1
          ${assetId ? 'AND a.id = $2' : ''}
          AND (a.display_name IS NOT NULL OR a.username IS NOT NULL
               OR a.avatar_url IS NOT NULL
               OR EXISTS (SELECT 1 FROM social_organic_account_metrics_daily m
                           WHERE m.asset_id = a.id)
               OR EXISTS (SELECT 1 FROM social_organic_post_metrics_daily p
                           WHERE p.asset_id = a.id))
        ${lock ? 'FOR UPDATE OF a' : ''}`,
      assetId ? [YOUTUBE_PROVIDER, assetId] : [YOUTUBE_PROVIDER],
    );
    const date = (value: Date | string | null) =>
      value === null ? null : new Date(value);
    return rows.map((row) => ({
      ...row,
      assetCreatedAt: new Date(row.assetCreatedAt),
      confirmedAt: date(row.confirmedAt),
      reauthSince: date(row.reauthSince),
    }));
  }
}
