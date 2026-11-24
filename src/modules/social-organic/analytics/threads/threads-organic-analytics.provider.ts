import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  ThreadsApiClient,
  type ThreadsPost,
} from '../../providers/threads/threads-api.client';
import { THREADS_PROVIDER } from '../../providers/threads/threads-capabilities';
import type {
  SocialOrganicAnalyticsProvider,
  SocialOrganicAnalyticsSyncInput,
} from '../social-organic-analytics.provider';
import {
  SOCIAL_ORGANIC_POST_REFRESH_DAYS,
  calendarDayIn,
  enumerateCalendarDays,
  localDayStartEpochSeconds,
  shiftCalendarDay,
} from '../social-organic-analytics-time';
import { SocialOrganicMetricsWriterService } from '../social-organic-metrics-writer.service';
import {
  normalizeThreadsAccountDay,
  normalizeThreadsPostDay,
  type ThreadsAccountDay,
} from './threads-organic.normalizer';

/** DOCUMENTED: user insights are not guaranteed before 2024-06-01. */
export const THREADS_INSIGHTS_EARLIEST_DAY = '2024-06-01';
/** 25 per page, 2 pages: bounds one run to 50 posts (+1 insights call each). */
export const THREADS_POST_PAGE_SIZE = 25;
export const THREADS_MAX_POST_PAGES = 2;

/**
 * D-I3 for Threads. `views` comes as a daily series (one call for the
 * window, filed like Meta's: the `end_time` day in the asset zone, minus
 * one). likes/replies/reposts/quotes/clicks only answer one total per
 * window, so each day is its own call (the window is 2 days scheduled, ≤ 7
 * on demand). `followers_count` is a stock with no history: it lands on
 * today's row. Recent posts get lifetime counters when the window reaches
 * today.
 */
@Injectable()
export class ThreadsOrganicAnalyticsProvider implements SocialOrganicAnalyticsProvider {
  readonly providers = [THREADS_PROVIDER];

  constructor(
    private readonly client: ThreadsApiClient,
    private readonly writer: SocialOrganicMetricsWriterService,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async sync(input: SocialOrganicAnalyticsSyncInput): Promise<void> {
    const { resolved, syncRunId, counters } = input;
    const { credential, assetTimezone } = resolved;
    const accessToken = credential.accessToken;
    const userId = credential.externalAssetId;
    const now = new Date();
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const today = calendarDayIn(assetTimezone, now);
    const toDay = input.toDate < today ? input.toDate : today;
    const fromDay =
      input.fromDate > THREADS_INSIGHTS_EARLIEST_DAY
        ? input.fromDate
        : THREADS_INSIGHTS_EARLIEST_DAY;
    if (fromDay > toDay) return;

    const dayStart = (day: string) =>
      localDayStartEpochSeconds(day, assetTimezone);
    const dayEnd = (day: string) =>
      Math.min(dayStart(shiftCalendarDay(day, 1)), nowSeconds);

    const base = {
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      assetId: credential.assetId,
      assetTimezone,
      syncedAt: now,
      syncRunId,
    };

    const days = enumerateCalendarDays(fromDay, toDay);
    const window = await this.client.userInsights({
      userId,
      accessToken,
      since: dayStart(fromDay),
      until: dayEnd(toDay),
    });
    counters.apiCalls += 1;
    const viewsByDay = new Map<string, number>();
    for (const entry of window.viewsSeries) {
      const endsAt = new Date(entry.endTime);
      if (Number.isNaN(endsAt.getTime())) continue;
      const day = shiftCalendarDay(calendarDayIn(assetTimezone, endsAt), -1);
      viewsByDay.set(day, (viewsByDay.get(day) ?? 0) + entry.value);
    }

    const includesToday = toDay === today;
    let followersCount: number | null = null;
    if (includesToday) {
      followersCount = await this.client.followersCount({
        userId,
        accessToken,
      });
      counters.apiCalls += 1;
    }

    const accountRows: ReturnType<typeof normalizeThreadsAccountDay>[] = [];
    for (const day of days) {
      const since = dayStart(day);
      const until = dayEnd(day);
      if (until <= since) continue;
      const totals =
        days.length === 1
          ? window
          : await this.client.userInsights({
              userId,
              accessToken,
              since,
              until,
            });
      if (days.length > 1) counters.apiCalls += 1;
      const metrics: ThreadsAccountDay = {
        views: viewsByDay.get(day) ?? null,
        likes: totals.likes,
        replies: totals.replies,
        reposts: totals.reposts,
        quotes: totals.quotes,
        clicks: totals.clicks,
      };
      accountRows.push(
        normalizeThreadsAccountDay(base, {
          day,
          partial: day === today,
          metrics,
          followersCount: day === today ? followersCount : null,
        }),
      );
    }

    const postRows: ReturnType<typeof normalizeThreadsPostDay>[] = [];
    if (includesToday) {
      const posts: ThreadsPost[] = [];
      const since = dayStart(
        shiftCalendarDay(today, -SOCIAL_ORGANIC_POST_REFRESH_DAYS),
      );
      let after: string | undefined;
      for (let page = 0; page < THREADS_MAX_POST_PAGES; page += 1) {
        const result = await this.client.listPosts({
          userId,
          accessToken,
          since,
          limit: THREADS_POST_PAGE_SIZE,
          after,
        });
        counters.apiCalls += 1;
        posts.push(...result.posts);
        if (!result.after) break;
        after = result.after;
      }
      // A repost of someone else's thread has no insights of its own.
      const own = posts.filter((post) => post.mediaType !== 'REPOST_FACADE');
      const owned = await this.lyraPublicationIds(
        credential.assetId,
        own.map((post) => post.id),
      );
      for (const post of own) {
        const insights = await this.client.postInsights({
          mediaId: post.id,
          accessToken,
        });
        counters.apiCalls += 1;
        postRows.push(
          normalizeThreadsPostDay(base, post, insights, {
            day: today,
            observedAt: now,
            publicationId: owned.get(post.id) ?? null,
          }),
        );
      }
    }

    const written = await this.writer.upsert({ accountRows, postRows });
    counters.rowsWritten += written.accountRows + written.postRows;
  }

  /** Lyra's own publication per post (`threads_publish` answers the media id). */
  private async lyraPublicationIds(assetId: string, mediaIds: string[]) {
    if (mediaIds.length === 0) return new Map<string, string>();
    const rows = await this.dataSource.query<
      Array<{ id: string; external_publication_id: string }>
    >(
      `SELECT id, external_publication_id
         FROM social_publications
        WHERE asset_id = $1
          AND external_publication_id = ANY($2::text[])`,
      [assetId, mediaIds],
    );
    return new Map(rows.map((row) => [row.external_publication_id, row.id]));
  }
}
