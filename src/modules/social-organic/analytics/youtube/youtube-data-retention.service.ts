import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { YOUTUBE_PROVIDER } from '../../providers/youtube/youtube-capabilities';

export const SOCIAL_YOUTUBE_DATA_RETENTION_ENABLED_ENV =
  'SOCIAL_YOUTUBE_DATA_RETENTION_ENABLED';

/**
 * YouTube API Services Developer Policies (III.E.4 and "Revocation"): Authorized
 * Data goes within 7 days of a revocation through Lyra and within 30 days of a
 * revocation at Google; stored data that is not refreshed within 30 days goes.
 *
 * A revocation at Google is only seen at the next token refresh, which marks
 * the authorization `reauth_required`. The daily sync refreshes it, so 20 days
 * after that mark leaves room inside the 30 for detection and for this sweep.
 * Other causes (expired grant, password change) get the same 20 days to reconnect.
 */
export const YOUTUBE_REAUTH_GRACE_DAYS = 20;
/** Video titles and publish times (Data API) not refreshed in this window go. */
export const YOUTUBE_DETAIL_MAX_AGE_DAYS = 30;

const LOCK_KEY = 'social_youtube_data_retention';
const DAY_MS = 86_400_000;

/** Tables the YouTube provider writes, keyed by the channel asset. */
const YOUTUBE_ASSET_DATA_TABLES = [
  'social_organic_post_metrics_daily',
  'social_organic_account_metrics_daily',
] as const;

export type YoutubePurgeReason = 'disconnected' | 'reauth_expired';

type Candidate = {
  assetId: string;
  tenantId: string;
  organicActive: boolean;
  authorizationId: string | null;
  authorizationStatus: string | null;
  reauthSince: Date | null;
};

export type YoutubeRetentionResult = {
  purgedAssets: number;
  deletedRows: number;
  staleDetailRows: number;
};

export function youtubeDataRetentionEnabled(): boolean {
  // On unless explicitly braked: deletion is a policy obligation, not a feature.
  return (
    process.env[
      SOCIAL_YOUTUBE_DATA_RETENTION_ENABLED_ENV
    ]?.trim().toLowerCase() !== 'false'
  );
}

/**
 * Why an asset's YouTube data must go now, or null while it may stay. Live =
 * the channel is active in Lyra and backed by a connected Google YouTube link.
 */
export function youtubePurgeReason(
  candidate: Candidate,
  now: Date,
): YoutubePurgeReason | null {
  if (!candidate.organicActive || !candidate.authorizationId)
    return 'disconnected';
  if (candidate.authorizationStatus === 'connected') return null;
  // `reauth_required`: tokens are gone; the user may still reconnect.
  const since = candidate.reauthSince?.getTime() ?? now.getTime();
  return now.getTime() - since >= YOUTUBE_REAUTH_GRACE_DAYS * DAY_MS
    ? 'reauth_expired'
    : null;
}

/**
 * Deletes stored YouTube API data that Lyra may no longer keep: the metrics and
 * video details of a channel that was disconnected or whose Google access was
 * revoked, plus the channel's title, handle and avatar on its asset row. The
 * asset row and Lyra's own publication records stay (Planner history; they hold
 * what the user wrote, not API data). Each purge leaves a
 * `youtube_data_purged` audit event.
 */
@Injectable()
export class YoutubeDataRetentionService {
  private readonly logger = new Logger(YoutubeDataRetentionService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
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
    if (result.purgedAssets > 0 || result.staleDetailRows > 0) {
      this.logger.log(
        `YouTube data retention: ${result.purgedAssets} channel(s) purged, ${result.deletedRows} metric row(s) deleted, ${result.staleDetailRows} stale video detail row(s) cleared.`,
      );
    }
    return result;
  }

  /**
   * Purges one asset, re-deciding under its row lock so a reconnection that
   * commits first wins. Returns rows deleted, or null when it no longer applies.
   */
  async purgeAsset(assetId: string, now: Date): Promise<number | null> {
    return this.dataSource.transaction(async (manager) => {
      const [candidate] = await this.candidates(manager, assetId);
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
   * Clears video titles and publish times that no sync refreshed for
   * YOUTUBE_DETAIL_MAX_AGE_DAYS (the sync refreshes every row of each video it
   * reads). Metrics are YouTube Analytics data and stay while authorized.
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
          AND NOT EXISTS (
            SELECT 1 FROM social_organic_post_metrics_daily f
             WHERE f.asset_id = p.asset_id
               AND f.external_publication_id = p.external_publication_id
               AND f.synced_at >= $2)`,
      [YOUTUBE_PROVIDER, cutoff],
    );
    return count ?? 0;
  }

  /** YouTube assets still holding API data, with their liveness inputs. */
  private async candidates(
    manager: EntityManager,
    assetId?: string,
  ): Promise<Candidate[]> {
    const rows = await manager.query<
      Array<{
        assetId: string;
        tenantId: string;
        organicActive: boolean;
        authorizationId: string | null;
        authorizationStatus: string | null;
        reauthSince: Date | string | null;
      }>
    >(
      `SELECT a.id AS "assetId", a.tenant_id AS "tenantId",
              (a.status = 'active' AND c.connection_status = 'connected'
                 AND c.credential_removed_at IS NULL) AS "organicActive",
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
        ${assetId ? 'FOR UPDATE OF a' : ''}`,
      assetId ? [YOUTUBE_PROVIDER, assetId] : [YOUTUBE_PROVIDER],
    );
    return rows.map((row) => ({
      ...row,
      reauthSince: row.reauthSince ? new Date(row.reauthSince) : null,
    }));
  }
}
