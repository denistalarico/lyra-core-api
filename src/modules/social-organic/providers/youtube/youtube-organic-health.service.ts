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
/** Above this many stored videos the check skips the video verification (and
 * its stamp), leaving the 30-day expiry to clear stale titles. */
const MAX_VERIFIED_VIDEOS = 10_000;

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
 * 3. re-reads every stored video: titles and publish times are refreshed, and
 *    the metrics of a video YouTube no longer returns (deleted) are removed;
 * 4. stamps `metadata.youtubeConfirmedAt` (grant and channel) and, when every
 *    stored video was re-read, `metadata.youtubeVideosVerifiedAt`: the clocks
 *    the retention rules use.
 * A definitive failure marks the asset `unhealthy`; a transient one changes
 * nothing and is retried next hour.
 */
@Injectable()
export class YoutubeOrganicHealthService implements SocialOrganicHealthProvider {
  readonly providers = [YOUTUBE_PROVIDER];
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
    let videoIds: string[];
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

      videoIds = await this.storedVideoIds(asset.id);
      details =
        videoIds.length > 0 && videoIds.length <= MAX_VERIFIED_VIDEOS
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

    const verified = videoIds.length <= MAX_VERIFIED_VIDEOS;
    const byId = new Map(details.map((detail) => [detail.videoId, detail]));
    const missing = verified ? videoIds.filter((id) => !byId.has(id)) : [];
    if (missing.length > 0 && missing.length === videoIds.length) {
      // Every video gone at once is more likely a wrong answer than a purge.
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

      if (verified) {
        await refreshYoutubeVideoDetails(manager, asset.id, videoIds, byId);
      }
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
      await manager.query(
        `UPDATE social_organic_assets
            SET display_name = $2, username = $3, avatar_url = $4,
                last_health_status = 'healthy', last_health_check_at = $5,
                metadata = COALESCE(metadata, '{}'::jsonb)
                  || jsonb_build_object('youtubeConfirmedAt', $7::text)
                  || CASE WHEN $6::boolean
                       THEN jsonb_build_object('youtubeVideosVerifiedAt', $7::text)
                       ELSE '{}'::jsonb END,
                updated_at = now()
          WHERE id = $1`,
        [
          asset.id,
          channel.title.slice(0, 240),
          channel.customUrl?.slice(0, 180) ?? null,
          channel.thumbnailUrl,
          now,
          verified,
          now.toISOString(),
        ],
      );
      return 'healthy' as const;
    });
  }

  private async storedVideoIds(assetId: string): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ id: string }>>(
      `SELECT DISTINCT external_publication_id AS id
         FROM social_organic_post_metrics_daily
        WHERE asset_id = $1
        LIMIT ${MAX_VERIFIED_VIDEOS + 1}`,
      [assetId],
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
