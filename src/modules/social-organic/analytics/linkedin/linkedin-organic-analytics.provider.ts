import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  LinkedInOrganicApiClient,
  type LinkedInShareStats,
} from '../../providers/linkedin/linkedin-organic-api.client';
import { LINKEDIN_PROVIDER } from '../../providers/linkedin/linkedin-capabilities';
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
  LINKEDIN_PARTIAL_DAYS,
  normalizeLinkedInAccountDay,
  normalizeLinkedInPostDay,
} from './linkedin-organic.normalizer';

/** Posts whose lifetime counters are refreshed per run (one finder call). */
export const LINKEDIN_RECENT_POSTS = 50;
/** Statistics live in a rolling 12-month window (DOCUMENTED). */
const LINKEDIN_RETENTION_DAYS = 365;

/**
 * D-I3: LinkedIn Page statistics into the existing organic tables. Per run
 * (≈ 5–6 calls of the 500/day Development budget): daily share statistics,
 * daily follower gains, the follower stock (`networkSizes`), the newest posts
 * and their lifetime statistics. Days are UTC, cut at yesterday.
 */
@Injectable()
export class LinkedInOrganicAnalyticsProvider implements SocialOrganicAnalyticsProvider {
  readonly providers = [LINKEDIN_PROVIDER];

  constructor(
    private readonly client: LinkedInOrganicApiClient,
    private readonly writer: SocialOrganicMetricsWriterService,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async sync(input: SocialOrganicAnalyticsSyncInput): Promise<void> {
    const { resolved, syncRunId, counters } = input;
    const { credential, assetTimezone } = resolved;
    const accessToken = credential.accessToken;
    const organizationId = credential.externalAssetId;
    const now = new Date();
    const today = calendarDayIn(assetTimezone, now);
    const lastDay = shiftCalendarDay(today, -1);
    const oldest = shiftCalendarDay(today, -(LINKEDIN_RETENTION_DAYS - 1));
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
    const range = { fromDay, toDay };

    const shareDays = await this.client.dailyShareStatistics(
      accessToken,
      organizationId,
      range,
    );
    counters.apiCalls += 1;
    const gainDays = await this.client.dailyFollowerGains(
      accessToken,
      organizationId,
      range,
    );
    counters.apiCalls += 1;
    const includesLastDay = toDay === lastDay;
    let followers: number | null = null;
    if (includesLastDay) {
      followers = await this.client.followerCount(accessToken, organizationId);
      counters.apiCalls += 1;
    }

    const stats = new Map(shareDays.map((entry) => [entry.day, entry.stats]));
    const gains = new Map(gainDays.map((entry) => [entry.day, entry]));
    const partialFrom = shiftCalendarDay(today, -LINKEDIN_PARTIAL_DAYS);
    const accountRows = enumerateCalendarDays(fromDay, toDay)
      .filter(
        (day) =>
          stats.has(day) ||
          gains.has(day) ||
          (day === toDay && followers !== null),
      )
      .map((day) =>
        normalizeLinkedInAccountDay(base, {
          day,
          partial: day >= partialFrom,
          stats: stats.get(day),
          gains: gains.get(day),
          // The stock is "now": only on the newest day of the window.
          followersCount: includesLastDay && day === toDay ? followers : null,
        }),
      );

    let postRows: ReturnType<typeof normalizeLinkedInPostDay>[] = [];
    if (includesLastDay) {
      const posts = await this.client.organizationPosts(
        accessToken,
        organizationId,
        LINKEDIN_RECENT_POSTS,
      );
      counters.apiCalls += 1;
      const urns = posts.map((post) => post.urn);
      const lifetime =
        urns.length > 0
          ? await this.client.postStatistics(accessToken, organizationId, urns)
          : { stats: new Map<string, LinkedInShareStats>(), apiCalls: 0 };
      counters.apiCalls += lifetime.apiCalls;
      const owned = await this.lyraPublicationIds(credential.assetId, urns);
      postRows = posts.map((post) =>
        normalizeLinkedInPostDay(base, post, {
          day: toDay,
          observedAt: now,
          stats: lifetime.stats.get(post.urn),
          publicationId: owned.get(post.urn) ?? null,
        }),
      );
    }

    const written = await this.writer.upsert({ accountRows, postRows });
    counters.rowsWritten += written.accountRows + written.postRows;
  }

  private async lyraPublicationIds(assetId: string, urns: string[]) {
    if (urns.length === 0) return new Map<string, string>();
    const rows = await this.dataSource.query<
      Array<{ id: string; external_publication_id: string }>
    >(
      `SELECT id, external_publication_id
         FROM social_publications
        WHERE asset_id = $1
          AND external_publication_id = ANY($2::text[])`,
      [assetId, urns],
    );
    return new Map(rows.map((row) => [row.external_publication_id, row.id]));
  }
}
