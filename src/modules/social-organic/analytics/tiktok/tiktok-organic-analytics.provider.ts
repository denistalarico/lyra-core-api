import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  TiktokApiClient,
  type TiktokVideo,
} from '../../providers/tiktok/tiktok-api.client';
import { TIKTOK_PROVIDER } from '../../providers/tiktok/tiktok-capabilities';
import type {
  SocialOrganicAnalyticsProvider,
  SocialOrganicAnalyticsSyncInput,
} from '../social-organic-analytics.provider';
import { calendarDayIn } from '../social-organic-analytics-time';
import { SocialOrganicMetricsWriterService } from '../social-organic-metrics-writer.service';
import {
  normalizeTiktokAccountDay,
  normalizeTiktokPostDay,
} from './tiktok-organic.normalizer';

/** 20 per page: bounds one run to 10 calls / 200 videos (rate-safe). */
export const TIKTOK_MAX_VIDEO_PAGES = 10;

/**
 * D-I3: TikTok into the existing organic tables. The API only answers "now"
 * (follower stock and per-video cumulative counters), so one run writes one
 * snapshot day: today in the asset timezone. A window that ends before today
 * has nothing TikTok can answer and is skipped.
 */
@Injectable()
export class TiktokOrganicAnalyticsProvider implements SocialOrganicAnalyticsProvider {
  readonly providers = [TIKTOK_PROVIDER];

  constructor(
    private readonly client: TiktokApiClient,
    private readonly writer: SocialOrganicMetricsWriterService,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async sync(input: SocialOrganicAnalyticsSyncInput): Promise<void> {
    const { resolved, syncRunId, counters } = input;
    const { credential, assetTimezone } = resolved;
    const now = new Date();
    const today = calendarDayIn(assetTimezone, now);
    if (input.toDate < today) return;

    const accessToken = credential.accessToken;
    const base = {
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      assetId: credential.assetId,
      assetTimezone,
      syncedAt: now,
      syncRunId,
    };

    const user = await this.client.userInfo(accessToken);
    counters.apiCalls += 1;

    const videos: TiktokVideo[] = [];
    let cursor: number | undefined;
    for (let page = 0; page < TIKTOK_MAX_VIDEO_PAGES; page += 1) {
      const result = await this.client.listVideos({ accessToken, cursor });
      counters.apiCalls += 1;
      videos.push(...result.videos);
      if (!result.hasMore || result.cursor === null) break;
      cursor = result.cursor;
    }

    const owned = await this.lyraPublicationIds(
      credential.assetId,
      videos.map((video) => video.id),
    );
    const accountRows = [normalizeTiktokAccountDay(base, user, today)];
    const postRows = videos.map((video) =>
      normalizeTiktokPostDay(base, video, {
        day: today,
        observedAt: now,
        publicationId: owned.get(video.id) ?? null,
      }),
    );

    const written = await this.writer.upsert({ accountRows, postRows });
    counters.rowsWritten += written.accountRows + written.postRows;
  }

  /** Lyra's own publication per video (set once TikTok exposes the post id). */
  private async lyraPublicationIds(assetId: string, videoIds: string[]) {
    if (videoIds.length === 0) return new Map<string, string>();
    const rows = await this.dataSource.query<
      Array<{ id: string; external_publication_id: string }>
    >(
      `SELECT id, external_publication_id
         FROM social_publications
        WHERE asset_id = $1
          AND external_publication_id = ANY($2::text[])`,
      [assetId, videoIds],
    );
    return new Map(rows.map((row) => [row.external_publication_id, row.id]));
  }
}
