import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
  YOUTUBE_CHANNEL_DAY_METRICS,
  YOUTUBE_TOP_VIDEOS_LIMIT,
  YOUTUBE_VIDEO_DAY_METRICS,
  YoutubeAnalyticsClient,
  type YoutubeReportRow,
  type YoutubeVideoDetail,
} from './youtube-analytics.client';
import {
  isPartialDay,
  normalizeYoutubeAccountDay,
  normalizeYoutubePostDay,
} from './youtube-organic.normalizer';

export const YOUTUBE_ORGANIC_PROVIDER = 'youtube';

/**
 * D-I3: YouTube Analytics into the existing organic tables. Per run: one
 * channel report over the window (`dimensions=day`), one top-200 video report
 * per day (`dimensions=video`), one `channels.list` and the `videos.list`
 * batches for titles. The window is cut at yesterday (the API has no data for
 * today); D-1 and D-2 are stored `is_partial`.
 */
@Injectable()
export class YoutubeOrganicAnalyticsProvider implements SocialOrganicAnalyticsProvider {
  readonly providers = [YOUTUBE_ORGANIC_PROVIDER];

  constructor(
    private readonly client: YoutubeAnalyticsClient,
    private readonly writer: SocialOrganicMetricsWriterService,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async sync(input: SocialOrganicAnalyticsSyncInput): Promise<void> {
    const { resolved, syncRunId, counters } = input;
    const { credential, assetTimezone } = resolved;
    const accessToken = credential.accessToken;
    const now = new Date();
    const today = calendarDayIn(assetTimezone, now);
    const lastDay = shiftCalendarDay(today, -1);
    const toDate = input.toDate < lastDay ? input.toDate : lastDay;
    if (input.fromDate > toDate) return;
    // The daily window is only today and yesterday, but D-2 and D-3 are still
    // moving at YouTube: a window reaching D-1 is widened to D-3 (YT3, §12.4).
    const refreshFrom = shiftCalendarDay(today, -3);
    const fromDate =
      toDate === lastDay && refreshFrom < input.fromDate
        ? refreshFrom
        : input.fromDate;
    const days = enumerateCalendarDays(fromDate, toDate);

    const base = {
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      assetId: credential.assetId,
      assetTimezone,
      syncedAt: now,
      syncRunId,
    };

    const channelRows = await this.client.query({
      accessToken,
      startDate: fromDate,
      endDate: toDate,
      dimensions: 'day',
      metrics: YOUTUBE_CHANNEL_DAY_METRICS,
    });
    counters.apiCalls += 1;

    const subscribers = await this.client.subscriberCount(accessToken);
    counters.apiCalls += 1;

    const videosByDay = new Map<string, YoutubeReportRow[]>();
    for (const day of days) {
      const rows = await this.client.query({
        accessToken,
        startDate: day,
        endDate: day,
        dimensions: 'video',
        metrics: YOUTUBE_VIDEO_DAY_METRICS,
        sort: '-views',
        maxResults: YOUTUBE_TOP_VIDEOS_LIMIT,
      });
      counters.apiCalls += 1;
      videosByDay.set(day, rows);
    }

    const videoIds = [
      ...new Set(
        [...videosByDay.values()].flatMap((rows) =>
          rows.map((row) => String(row.video)),
        ),
      ),
    ];
    const details = new Map<string, YoutubeVideoDetail>();
    if (videoIds.length > 0) {
      const listed = await this.client.videoDetails(accessToken, videoIds);
      counters.apiCalls += listed.apiCalls;
      for (const detail of listed.details) details.set(detail.videoId, detail);
    }
    const owned = await this.lyraPublicationIds(credential.assetId, videoIds);

    // The subscriber count is "now": it goes only on the latest day of the
    // window, never stamped on older days it does not describe.
    const latest = channelRows.reduce(
      (max, row) => (String(row.day) > max ? String(row.day) : max),
      '',
    );
    const accountRows = channelRows
      .filter((row) => typeof row.day === 'string')
      .map((row) =>
        normalizeYoutubeAccountDay(base, row, {
          partial: isPartialDay(String(row.day), today, shiftCalendarDay),
          followersCount:
            String(row.day) === latest && subscribers !== null
              ? String(subscribers)
              : null,
        }),
      );
    const postRows = [...videosByDay.entries()].flatMap(([day, rows]) =>
      rows
        .filter((row) => typeof row.video === 'string')
        .map((row) =>
          normalizeYoutubePostDay(base, row, {
            day,
            partial: isPartialDay(day, today, shiftCalendarDay),
            detail: details.get(String(row.video)),
            publicationId: owned.get(String(row.video)) ?? null,
          }),
        ),
    );

    const written = await this.writer.upsert({ accountRows, postRows });
    counters.rowsWritten += written.accountRows + written.postRows;
    await this.refreshVideoDetails(credential.assetId, videoIds, details);
  }

  /**
   * YouTube policy (III.E.4): stored Data API fields must be refreshed or
   * deleted within 30 days. Every older row of a video just read gets its
   * current title and publish time; a video `videos.list` no longer returns
   * (deleted or private) loses them. Unread videos expire in
   * `YoutubeDataRetentionService.expireStaleDetails`.
   */
  private async refreshVideoDetails(
    assetId: string,
    videoIds: string[],
    details: ReadonlyMap<string, YoutubeVideoDetail>,
  ) {
    if (videoIds.length === 0) return;
    await this.dataSource.query(
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

  /** Lyra's own publication per video; the id is stored with or without prefix. */
  private async lyraPublicationIds(assetId: string, videoIds: string[]) {
    if (videoIds.length === 0) return new Map<string, string>();
    const rows = await this.dataSource.query<
      Array<{ id: string; external_publication_id: string }>
    >(
      `SELECT id, external_publication_id
         FROM social_publications
        WHERE asset_id = $1
          AND external_publication_id = ANY($2::text[])`,
      [assetId, videoIds.flatMap((id) => [id, `yt-video:${id}`])],
    );
    return new Map(
      rows.map((row) => [
        row.external_publication_id.replace(/^yt-video:/, ''),
        row.id,
      ]),
    );
  }
}
