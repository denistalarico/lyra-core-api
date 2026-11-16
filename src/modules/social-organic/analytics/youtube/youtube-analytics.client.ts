import { Injectable } from '@nestjs/common';
import { YoutubeApiError } from '../../providers/youtube/youtube-api.client';

const ANALYTICS_HOST = 'https://youtubeanalytics.googleapis.com/v2/reports';
const DATA_HOST = 'https://www.googleapis.com/youtube/v3';
const REQUEST_TIMEOUT_MS = 30_000;
const VIDEO_LIST_BATCH = 50;

/**
 * Metric lists are fixed constants, reviewed against the official reports:
 * https://developers.google.com/youtube/analytics/channel_reports (2026-11-16)
 * "User activity by country for specific time periods" (dimensions=day) and
 * "Top videos with optional regional filters" (dimensions=video; sort only on
 * views, estimatedMinutesWatched, subscribersGained, subscribersLost; at most
 * 200 rows). One invalid metric fails the whole query (lesson of B1/B2), so a
 * spec pins these lists.
 */
export const YOUTUBE_CHANNEL_DAY_METRICS = [
  'views',
  'engagedViews',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'subscribersGained',
  'subscribersLost',
  'likes',
  'comments',
  'shares',
] as const;
export const YOUTUBE_VIDEO_DAY_METRICS = YOUTUBE_CHANNEL_DAY_METRICS;
export const YOUTUBE_TOP_VIDEOS_LIMIT = 200;

export type YoutubeReportRow = Record<string, number | string>;

export type YoutubeVideoDetail = {
  videoId: string;
  title: string | null;
  publishedAt: Date | null;
};

@Injectable()
export class YoutubeAnalyticsClient {
  /** `reports.query` for the authorized channel; rows keyed by column name. */
  async query(input: {
    accessToken: string;
    startDate: string;
    endDate: string;
    dimensions: 'day' | 'video';
    metrics: readonly string[];
    sort?: string;
    maxResults?: number;
  }): Promise<YoutubeReportRow[]> {
    const params = new URLSearchParams({
      ids: 'channel==MINE',
      startDate: input.startDate,
      endDate: input.endDate,
      dimensions: input.dimensions,
      metrics: input.metrics.join(','),
    });
    if (input.sort) params.set('sort', input.sort);
    if (input.maxResults) params.set('maxResults', String(input.maxResults));

    const body = (await this.get(
      `${ANALYTICS_HOST}?${params}`,
      input.accessToken,
    )) as {
      columnHeaders?: Array<{ name?: unknown }>;
      rows?: unknown;
    };
    const names = (body.columnHeaders ?? []).map((header) =>
      typeof header.name === 'string' ? header.name : '',
    );
    if (!names.length || !names.every(Boolean)) {
      throw new YoutubeApiError(502, 'invalid_response');
    }
    const rows: YoutubeReportRow[] = [];
    for (const raw of Array.isArray(body.rows) ? body.rows : []) {
      if (!Array.isArray(raw) || raw.length !== names.length) continue;
      const row: YoutubeReportRow = {};
      names.forEach((name, index) => {
        const value: unknown = raw[index];
        if (typeof value === 'number' || typeof value === 'string') {
          row[name] = value;
        }
      });
      rows.push(row);
    }
    return rows;
  }

  /** Subscriber count of the channel; null when the channel hides it. */
  async subscriberCount(accessToken: string): Promise<number | null> {
    const body = (await this.get(
      `${DATA_HOST}/channels?${new URLSearchParams({ part: 'statistics', mine: 'true' })}`,
      accessToken,
    )) as {
      items?: Array<{
        statistics?: {
          subscriberCount?: unknown;
          hiddenSubscriberCount?: unknown;
        };
      }>;
    };
    const stats = body.items?.[0]?.statistics;
    if (!stats || stats.hiddenSubscriberCount === true) return null;
    const count = Number(stats.subscriberCount);
    return Number.isFinite(count) && count >= 0 ? count : null;
  }

  /** Titles and publish times, 50 ids per `videos.list` call (1 unit each). */
  async videoDetails(
    accessToken: string,
    videoIds: readonly string[],
  ): Promise<{ details: YoutubeVideoDetail[]; apiCalls: number }> {
    const details: YoutubeVideoDetail[] = [];
    let apiCalls = 0;
    for (let i = 0; i < videoIds.length; i += VIDEO_LIST_BATCH) {
      const batch = videoIds.slice(i, i + VIDEO_LIST_BATCH);
      const body = (await this.get(
        `${DATA_HOST}/videos?${new URLSearchParams({ part: 'snippet', id: batch.join(',') })}`,
        accessToken,
      )) as {
        items?: Array<{
          id?: unknown;
          snippet?: { title?: unknown; publishedAt?: unknown };
        }>;
      };
      apiCalls += 1;
      for (const item of body.items ?? []) {
        if (typeof item.id !== 'string') continue;
        const published =
          typeof item.snippet?.publishedAt === 'string'
            ? new Date(item.snippet.publishedAt)
            : null;
        details.push({
          videoId: item.id,
          title:
            typeof item.snippet?.title === 'string' ? item.snippet.title : null,
          publishedAt:
            published && !Number.isNaN(published.getTime()) ? published : null,
        });
      }
    }
    return { details, apiCalls };
  }

  private async get(url: string, accessToken: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new YoutubeApiError(503, 'network');
    }
    if (!response.ok) {
      let reason: string | null = null;
      try {
        const body = (await response.json()) as {
          error?: { errors?: Array<{ reason?: unknown }> };
        };
        const first = body.error?.errors?.[0]?.reason;
        reason = typeof first === 'string' ? first : null;
      } catch {
        reason = null;
      }
      throw new YoutubeApiError(response.status, reason);
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new YoutubeApiError(502, 'invalid_response');
    }
  }
}
