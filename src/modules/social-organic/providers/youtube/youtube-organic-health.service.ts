import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  GoogleApiClient,
  GoogleApiError,
} from '../../../social-google/google-api.client';
import { YoutubeAnalyticsClient } from '../../analytics/youtube/youtube-analytics.client';
import { refreshYoutubeVideoDetails } from '../../analytics/youtube/youtube-data-retention.service';
import type { SocialOrganicHealthProvider } from '../../connections/social-organic-health.provider';
import { SocialOrganicCredentialError } from '../../credentials/social-organic-credential.error';
import { SocialOrganicCredentialResolver } from '../../credentials/social-organic-credential.resolver';
import { SocialOrganicAssetEntity } from '../../entities';
import { YoutubeApiError } from './youtube-api.client';
import { YOUTUBE_PROVIDER } from './youtube-capabilities';

/** One check per channel per day, from the hourly health scheduler. */
const CHECK_EVERY_MS = 20 * 60 * 60 * 1000;
/**
 * Stored videos re-read per daily check (200 `videos.list` calls). A larger
 * channel is verified in rotating batches (`metadata.youtubeVideoCursor`), so a
 * full pass over up to 290,000 videos still completes inside 30 days.
 */
export const YOUTUBE_VIDEO_VERIFY_BATCH = 10_000;
const CURSOR_KEY = 'youtubeVideoCursor';
const CYCLE_KEY = 'youtubeVideoCycleStartedAt';

export type YoutubeHealthOutcome =
  | 'healthy'
  | 'unhealthy'
  | 'skipped_transient'
  | 'skipped_anomaly'
  | 'skipped_inactive';

/**
 * Daily re-verification of every live YouTube channel (Developer Policies
 * III.D.2.3 and III.E.4), read-only at YouTube:
 * 1. refreshes the Google token, which reconfirms the grant (a refused refresh
 *    marks the authorization `reauth_required`);
 * 2. confirms the channel is still reachable by the authorized account and
 *    refreshes its name, handle and avatar;
 * 3. re-reads the stored videos (all of them, or the next batch of a large
 *    channel): titles and publish times are refreshed, and the metrics of a
 *    video YouTube no longer returns (deleted) are removed;
 * 4. stamps `metadata.youtubeConfirmedAt` (grant and channel) and, when a pass
 *    over every stored video completes, `metadata.youtubeVideosVerifiedAt`
 *    (the pass's start): the clocks the retention rules use.
 * A definitive failure marks the asset `unhealthy`; a transient one changes
 * nothing and is retried next hour.
 */
@Injectable()
export class YoutubeOrganicHealthService implements SocialOrganicHealthProvider {
  readonly providers = [YOUTUBE_PROVIDER];
  /** Videos per check; lowered only by specs. */
  videoBatchSize = YOUTUBE_VIDEO_VERIFY_BATCH;
  private readonly logger = new Logger(YoutubeOrganicHealthService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly credentials: SocialOrganicCredentialResolver,
    private readonly google: GoogleApiClient,
    private readonly youtube: YoutubeAnalyticsClient,
  ) {}

  async listEligibleForScheduledCheck(
    now: Date = new Date(),
  ): Promise<SocialOrganicAssetEntity[]> {
    return this.dataSource
      .getRepository(SocialOrganicAssetEntity)
      .createQueryBuilder('asset')
      .innerJoin('asset.connection', 'connection')
      .where('asset.provider = :provider', { provider: YOUTUBE_PROVIDER })
      .andWhere("asset.status = 'active'")
      .andWhere("connection.connectionStatus = 'connected'")
      .andWhere('connection.credentialRemovedAt IS NULL')
      .andWhere(
        '(asset.lastHealthCheckAt IS NULL OR asset.lastHealthCheckAt < :due)',
        { due: new Date(now.getTime() - CHECK_EVERY_MS) },
      )
      .getMany();
  }

  async runCheck(
    asset: SocialOrganicAssetEntity,
    now: Date = new Date(),
  ): Promise<YoutubeHealthOutcome> {
    let token: string;
    let channel:
      | { title: string; customUrl: string | null; thumbnailUrl: string | null }
      | undefined;
    const metadata = asset.metadata ?? {};
    const cursor =
      typeof metadata[CURSOR_KEY] === 'string' ? metadata[CURSOR_KEY] : null;
    const cycleStartedAt =
      cursor && typeof metadata[CYCLE_KEY] === 'string'
        ? metadata[CYCLE_KEY]
        : now.toISOString();
    let videoIds: string[];
    let passComplete: boolean;
    let details: Awaited<
      ReturnType<YoutubeAnalyticsClient['videoDetails']>
    >['details'];
    try {
      token = await this.credentials.resolveGoogleDiscoveryToken(
        {
          tenantId: asset.tenantId,
          workspaceId: asset.workspaceId,
          agencyClientId: asset.agencyClientId,
          companyContextId: asset.companyContextId,
        },
        YOUTUBE_PROVIDER,
      );
      channel = (await this.google.listYoutubeChannels(token)).find(
        (candidate) => candidate.channelId === asset.externalAssetId,
      );
      if (!channel)
        return this.markUnhealthy(asset, now, 'channel_unavailable');

      const batch = await this.storedVideoIds(asset.id, cursor);
      passComplete = batch.length <= this.videoBatchSize;
      videoIds = batch.slice(0, this.videoBatchSize);
      details =
        videoIds.length > 0
          ? (await this.youtube.videoDetails(token, videoIds)).details
          : [];
    } catch (error) {
      if (isDefinitive(error))
        return this.markUnhealthy(asset, now, failureCode(error));
      this.logger.warn(
        `YouTube health check deferred for asset ${asset.id} (${failureCode(error)}).`,
      );
      return 'skipped_transient';
    }

    const byId = new Map(details.map((detail) => [detail.videoId, detail]));
    const missing = videoIds.filter((id) => !byId.has(id));
    if (videoIds.length > 1 && missing.length === videoIds.length) {
      // Every video gone at once is more likely a wrong answer than a purge.
      // No stamp either: if it persists, the unverified rule purges the channel.
      this.logger.warn(
        `YouTube health check for asset ${asset.id}: none of ${videoIds.length} stored videos returned; nothing deleted.`,
      );
      return 'skipped_anomaly';
    }

    return this.dataSource.transaction(async (manager) => {
      const live = await manager.query<Array<{ id: string }>>(
        `SELECT a.id FROM social_organic_assets a
           JOIN social_organic_connections c ON c.id = a.connection_id
          WHERE a.id = $1 AND a.status = 'active'
            AND c.connection_status = 'connected'
            AND c.credential_removed_at IS NULL
          FOR UPDATE OF a`,
        [asset.id],
      );
      // Disconnected meanwhile: the retention purge owns it now.
      if (live.length === 0) return 'skipped_inactive' as const;

      await refreshYoutubeVideoDetails(manager, asset.id, videoIds, byId);
      if (missing.length > 0) {
        await manager.query(
          `DELETE FROM social_organic_post_metrics_daily
            WHERE asset_id = $1 AND external_publication_id = ANY($2::text[])`,
          [asset.id, missing],
        );
        this.logger.log(
          `YouTube health check for asset ${asset.id}: metrics of ${missing.length} video(s) no longer on YouTube deleted.`,
        );
      }
      // A finished pass stamps when it started: every video was re-read at or
      // after that moment. An unfinished one carries the cursor to tomorrow.
      const stamps: Record<string, string> = passComplete
        ? { youtubeVideosVerifiedAt: cycleStartedAt }
        : {
            [CURSOR_KEY]: videoIds[videoIds.length - 1],
            [CYCLE_KEY]: cycleStartedAt,
          };
      await manager.query(
        `UPDATE social_organic_assets
            SET display_name = $2, username = $3, avatar_url = $4,
                last_health_status = 'healthy', last_health_check_at = $5,
                metadata = (COALESCE(metadata, '{}'::jsonb) - $8::text - $9::text)
                  || jsonb_build_object('youtubeConfirmedAt', $6::text)
                  || $7::jsonb,
                updated_at = now()
          WHERE id = $1`,
        [
          asset.id,
          channel.title.slice(0, 240),
          channel.customUrl?.slice(0, 180) ?? null,
          channel.thumbnailUrl,
          now,
          now.toISOString(),
          JSON.stringify(stamps),
          CURSOR_KEY,
          CYCLE_KEY,
        ],
      );
      return 'healthy' as const;
    });
  }

  /** The next batch of stored video ids after the cursor, plus one look-ahead
   * row that tells whether the pass continues. */
  private async storedVideoIds(
    assetId: string,
    after: string | null,
  ): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT DISTINCT external_publication_id AS id
         FROM social_organic_post_metrics_daily
        WHERE asset_id = $1
          AND ($2::text IS NULL OR external_publication_id > $2::text)
        ORDER BY id
        LIMIT $3`,
      [assetId, after, this.videoBatchSize + 1],
    );
    return rows.map((row) => row.id);
  }

  private async markUnhealthy(
    asset: SocialOrganicAssetEntity,
    now: Date,
    code: string,
  ): Promise<'unhealthy'> {
    await this.dataSource.query(
      `UPDATE social_organic_assets
          SET last_health_status = 'unhealthy', last_health_check_at = $2,
              updated_at = now()
        WHERE id = $1 AND status = 'active'`,
      [asset.id, now],
    );
    this.logger.warn(
      `YouTube health check: asset ${asset.id} unhealthy (${code}).`,
    );
    return 'unhealthy';
  }
}

/** Refused for good (revoked grant, scopes or channel access lost). */
function isDefinitive(error: unknown): boolean {
  if (error instanceof SocialOrganicCredentialError)
    return error.code !== 'credential_refresh_failed';
  // `permission_denied` is every 403, quota included: not proof of anything.
  // A failure that persists still purges through the unverified rule.
  if (error instanceof GoogleApiError) return error.code === 'reauth_required';
  if (error instanceof YoutubeApiError)
    // 403 is also how quota and rate limits answer: those are transient.
    return (
      error.status === 401 ||
      (error.status === 403 && !/quota|rate|limit/i.test(error.reason ?? ''))
    );
  return false;
}

function failureCode(error: unknown): string {
  if (error instanceof SocialOrganicCredentialError) return error.code;
  if (error instanceof GoogleApiError) return error.code;
  if (error instanceof YoutubeApiError)
    return `youtube_${error.status}_${error.reason ?? 'unknown'}`.slice(0, 60);
  return error instanceof Error ? error.name : 'unknown';
}
