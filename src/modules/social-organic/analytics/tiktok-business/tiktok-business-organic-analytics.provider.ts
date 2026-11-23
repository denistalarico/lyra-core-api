import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  TiktokBusinessApiClient,
  type TiktokBusinessVideo,
} from '../../providers/tiktok-business/tiktok-business-api.client';
import { TIKTOK_BUSINESS_PROVIDER } from '../../providers/tiktok-business/tiktok-business-capabilities';
import type {
  SocialOrganicAnalyticsProvider,
  SocialOrganicAnalyticsSyncInput,
} from '../social-organic-analytics.provider';
import {
  calendarDayIn,
  enumerateCalendarDays,
  shiftCalendarDay,
} from '../social-organic-analytics-time';
import { SocialOrganicMetricsWriterService } from '../social-organic-metrics-writer.service';
import {
  TIKTOK_BUSINESS_PARTIAL_DAYS,
  normalizeTiktokBusinessAccountDay,
  normalizeTiktokBusinessPostDay,
} from './tiktok-business-organic.normalizer';

/** `/business/get/` look-back ceiling (DOCUMENTED: 60 days). */
export const TIKTOK_BUSINESS_LOOKBACK_DAYS = 60;
/** 20 per page: bounds one run to 5 calls / 100 posts (40 QPM per account). */
export const TIKTOK_BUSINESS_MAX_VIDEO_PAGES = 5;

/**
 * D-I3 for TikTok accounts authorized through the Business app: a daily UTC
 * series from `/business/get/` and lifetime post counters from
 * `/business/video/list/` (only when the window reaches yesterday, like
 * LinkedIn). Days are cut at yesterday; D-1/D-2 are stored partial.
 */
@Injectable()
export class TiktokBusinessOrganicAnalyticsProvider implements SocialOrganicAnalyticsProvider {
  readonly providers = [TIKTOK_BUSINESS_PROVIDER];

  constructor(
    private readonly client: TiktokBusinessApiClient,
    private readonly writer: SocialOrganicMetricsWriterService,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async sync(input: SocialOrganicAnalyticsSyncInput): Promise<void> {
    const { resolved, syncRunId, counters } = input;
    const { credential, assetTimezone } = resolved;
    const accessToken = credential.accessToken;
    const businessId = credential.externalAssetId;
    const now = new Date();
    const today = calendarDayIn(assetTimezone, now);
    const lastDay = shiftCalendarDay(today, -1);
    const oldest = shiftCalendarDay(today, -TIKTOK_BUSINESS_LOOKBACK_DAYS);
    const toDay = input.toDate < lastDay ? input.toDate : lastDay;
    const fromDay = input.fromDate > oldest ? input.fromDate : oldest;
    if (fromDay > toDay) return;

    const base = {
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      assetId: credential.assetId,
      assetTimezone,
      syncedAt: now,
      syncRunId,
    };

    const insights = await this.client.accountInsights({
      accessToken,
      businessId,
      startDate: fromDay,
      endDate: toDay,
    });
    counters.apiCalls += 1;

    const includesLastDay = toDay === lastDay;
    const byDay = new Map(insights.days.map((entry) => [entry.date, entry]));
    const partialFrom = shiftCalendarDay(today, -TIKTOK_BUSINESS_PARTIAL_DAYS);
    const accountRows = enumerateCalendarDays(fromDay, toDay)
      .filter(
        (day) =>
          byDay.has(day) ||
          (includesLastDay &&
            day === toDay &&
            insights.followersCount !== null),
      )
      .map((day) => {
        const metrics = byDay.get(day);
        // The day's own stock when TikTok has it; the real-time stock only
        // fills the newest day, which usually has not settled yet.
        const followersCount =
          metrics?.followersCount ??
          (includesLastDay && day === toDay ? insights.followersCount : null);
        return normalizeTiktokBusinessAccountDay(base, {
          day,
          partial: day >= partialFrom,
          metrics,
          followersCount,
        });
      });

    let postRows: ReturnType<typeof normalizeTiktokBusinessPostDay>[] = [];
    if (includesLastDay) {
      const videos: TiktokBusinessVideo[] = [];
      let cursor: number | undefined;
      for (let page = 0; page < TIKTOK_BUSINESS_MAX_VIDEO_PAGES; page += 1) {
        const result = await this.client.listVideos({
          accessToken,
          businessId,
          cursor,
        });
        counters.apiCalls += 1;
        videos.push(...result.videos);
        if (!result.hasMore || result.cursor === null) break;
        cursor = result.cursor;
      }
      const owned = await this.lyraPublicationIds(
        credential.assetId,
        videos.map((video) => video.itemId),
      );
      postRows = videos.map((video) =>
        normalizeTiktokBusinessPostDay(base, video, {
          day: toDay,
          observedAt: now,
          publicationId: owned.get(video.itemId) ?? null,
        }),
      );
    }

    const written = await this.writer.upsert({ accountRows, postRows });
    counters.rowsWritten += written.accountRows + written.postRows;
  }

  /** Lyra's own publication per post (`post_ids` of the publish status). */
  private async lyraPublicationIds(assetId: string, itemIds: string[]) {
    if (itemIds.length === 0) return new Map<string, string>();
    const rows = await this.dataSource.query<
      Array<{ id: string; external_publication_id: string }>
    >(
      `SELECT id, external_publication_id
         FROM social_publications
        WHERE asset_id = $1
          AND external_publication_id = ANY($2::text[])`,
      [assetId, itemIds],
    );
    return new Map(rows.map((row) => [row.external_publication_id, row.id]));
  }
}
