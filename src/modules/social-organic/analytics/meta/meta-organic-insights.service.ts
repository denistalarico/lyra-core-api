import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { ResolvedOrganicAnalyticsCredential } from '../../credentials/social-organic-credential.resolver';
import { MetaOrganicGraphService } from '../../providers/meta/meta-organic-graph.service';
import type {
  NormalizedOrganicAccountMetricDaily,
  NormalizedOrganicPostMetricDaily,
  SocialOrganicInsightsSyncSummary,
} from '../social-organic-insights.contract';
import { SocialOrganicMetricsWriterService } from '../social-organic-metrics-writer.service';
import {
  calendarDayIn,
  enumerateCalendarDays,
  localDayStartEpochSeconds,
  shiftCalendarDay,
} from '../social-organic-analytics-time';
import { SocialOrganicSyncError } from '../social-organic-sync.error';
import {
  normalizeFacebookAccountInsights,
  normalizeFacebookPostLifetimeSnapshot,
  normalizeInstagramAccountInsights,
  normalizeInstagramMediaLifetimeSnapshot,
} from './meta-organic-insights.normalizer';
import {
  FACEBOOK_PAGE_ACCOUNT_METRICS,
  FACEBOOK_POST_LIFETIME_METRICS,
  INSTAGRAM_ACCOUNT_FOLLOW_METRICS,
  INSTAGRAM_ACCOUNT_MEDIA_METRICS,
  INSTAGRAM_MEDIA_LIFETIME_METRICS,
} from './meta-organic-insights.types';

/** A Lyra-published post/media candidate for a lifetime snapshot read. */
type PublishedPostCandidate = {
  externalPublicationId: string;
  publicationId: string | null;
};

@Injectable()
export class MetaOrganicInsightsService {
  constructor(
    private readonly graph: MetaOrganicGraphService,
    private readonly writer: SocialOrganicMetricsWriterService,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  /** One atomic provider-to-read-model sync for one scoped asset and window. */
  async sync(input: {
    resolved: ResolvedOrganicAnalyticsCredential;
    fromDate: string;
    toDate: string;
    syncRunId: string;
    syncedAt?: Date;
  }): Promise<SocialOrganicInsightsSyncSummary> {
    const { credential, assetTimezone } = input.resolved;
    const days = enumerateCalendarDays(input.fromDate, input.toDate);
    const syncedAt = input.syncedAt ?? new Date();
    const currentDay = calendarDayIn(assetTimezone, syncedAt);

    if (credential.provider !== 'meta') {
      throw new SocialOrganicSyncError('unsupported_analytics_asset_type');
    }

    const base = {
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      assetId: credential.assetId,
      provider: credential.provider,
      assetTimezone,
      currentDay,
      syncedAt,
      syncRunId: input.syncRunId,
    };

    // Meta v26 exposes the candidate Page-post and IG-media counters only as
    // lifetime totals (period=lifetime), never as a documented daily flow.
    // A2 §1 gives them structurally separate `*_lifetime` snapshot columns on
    // the post table (see the entity docblock) instead of fabricating a daily
    // allocation. This loop is deliberately separate from the `for (const
    // metricDate of days)` account loop below: it is one lifetime fetch per
    // discovered post per sync call, gated by `needsCurrentSnapshot` — never
    // once per day in the window.
    const postRows: NormalizedOrganicPostMetricDaily[] = [];
    let apiCalls = 0;
    let rowsSkipped = 0;

    const accountRows: NormalizedOrganicAccountMetricDaily[] = [];
    const needsCurrentSnapshot = days.includes(currentDay);

    if (needsCurrentSnapshot) {
      // Discovery source = `social_publications` (Lyra-published posts only).
      // Confirmed scope decision, not an oversight: this intentionally
      // narrows lifetime metrics to Lyra-authored content in this pass. A
      // provider "list posts" call is out of scope here.
      const candidatePosts = await this.discoverPublishedPosts({
        assetId: credential.assetId,
        assetTimezone,
        fromDate: input.fromDate,
        toDate: input.toDate,
      });

      for (const post of candidatePosts) {
        if (credential.assetType === 'facebook_page') {
          const insights = await this.graph.getOrganicInsights({
            objectId: post.externalPublicationId,
            accessToken: credential.accessToken,
            metrics: FACEBOOK_POST_LIFETIME_METRICS,
            period: 'lifetime',
          });
          apiCalls += insights.apiCalls;
          // `metricDate` is always `currentDay` (the day of observation),
          // never the post's publish day and never iterated per day — a
          // lifetime total's meaning is "as observed now". The writer's
          // upsert key naturally collapses same-day resyncs into one row
          // while preserving one snapshot per calendar day a sync ran.
          const row = normalizeFacebookPostLifetimeSnapshot({
            ...base,
            metricDate: currentDay,
            externalPublicationId: post.externalPublicationId,
            publicationId: post.publicationId,
            insights,
            observedAt: syncedAt,
          });
          if (row) postRows.push(row);
          else rowsSkipped += 1;
          continue;
        }

        if (credential.assetType === 'instagram_professional') {
          const insights = await this.graph.getOrganicInsights({
            objectId: post.externalPublicationId,
            accessToken: credential.accessToken,
            metrics: INSTAGRAM_MEDIA_LIFETIME_METRICS,
            period: 'lifetime',
          });
          apiCalls += insights.apiCalls;
          const row = normalizeInstagramMediaLifetimeSnapshot({
            ...base,
            metricDate: currentDay,
            externalPublicationId: post.externalPublicationId,
            publicationId: post.publicationId,
            insights,
            observedAt: syncedAt,
          });
          if (row) postRows.push(row);
          else rowsSkipped += 1;
        }
      }
    }
    const followersCount = needsCurrentSnapshot
      ? await this.graph.getProfileFollowersCount({
          objectId: credential.externalAssetId,
          accessToken: credential.accessToken,
        })
      : undefined;
    if (needsCurrentSnapshot) apiCalls += 1;

    for (const metricDate of days) {
      const range = this.providerDayRange(metricDate, assetTimezone);

      if (credential.assetType === 'facebook_page') {
        const insights = await this.graph.getOrganicInsights({
          objectId: credential.externalAssetId,
          accessToken: credential.accessToken,
          metrics: FACEBOOK_PAGE_ACCOUNT_METRICS,
          period: 'day',
          breakdown: 'is_from_ads',
          ...range,
        });
        apiCalls += insights.apiCalls;
        const row = normalizeFacebookAccountInsights({
          ...base,
          metricDate,
          followersCount,
          insights,
        });
        if (row) accountRows.push(row);
        else rowsSkipped += 1;
        continue;
      }

      if (credential.assetType === 'instagram_professional') {
        const mediaInsights = await this.graph.getOrganicInsights({
          objectId: credential.externalAssetId,
          accessToken: credential.accessToken,
          metrics: INSTAGRAM_ACCOUNT_MEDIA_METRICS,
          period: 'day',
          metricType: 'total_value',
          breakdown: 'media_product_type',
          ...range,
        });
        const followInsights = await this.graph.getOrganicInsights({
          objectId: credential.externalAssetId,
          accessToken: credential.accessToken,
          metrics: INSTAGRAM_ACCOUNT_FOLLOW_METRICS,
          period: 'day',
          metricType: 'total_value',
          breakdown: 'follow_type',
          ...range,
        });
        apiCalls += mediaInsights.apiCalls + followInsights.apiCalls;
        const row = normalizeInstagramAccountInsights({
          ...base,
          metricDate,
          followersCount,
          mediaInsights,
          followInsights,
        });
        if (row) accountRows.push(row);
        else rowsSkipped += 1;
        continue;
      }

      throw new SocialOrganicSyncError('unsupported_analytics_asset_type');
    }

    const written = await this.writer.upsert({ postRows, accountRows });

    return {
      postRows: postRows.slice(0, written.postRows),
      accountRows: accountRows.slice(0, written.accountRows),
      rowsSkipped,
      apiCalls,
    };
  }

  private providerDayRange(metricDate: string, timezone: string) {
    return {
      since: localDayStartEpochSeconds(metricDate, timezone),
      // Meta's IG range is inclusive. Stop one second before next midnight.
      until:
        localDayStartEpochSeconds(shiftCalendarDay(metricDate, 1), timezone) -
        1,
    };
  }

  /**
   * Lyra-published posts/media in `[fromDate, toDate]` eligible for a
   * lifetime snapshot read.
   *
   * Reads `social_publications` directly — a small, read-only query on this
   * service, not `SocialOrganicSyncRunService`/`SocialPublicationExecutorService`,
   * which mutate state. Scope: `assetId`, `status = 'published'`,
   * `external_publication_id IS NOT NULL`, and `published_at` inside the
   * window (converted to an instant range the same way
   * `providerDayRange`/`localDayStartEpochSeconds` already convert calendar
   * days to instants).
   *
   * This intentionally covers Lyra-published content only — a documented
   * scope decision (confirmed), not an oversight: extending discovery to
   * every post/media a provider-side "list posts" call would return is out
   * of scope for this pass.
   */
  private async discoverPublishedPosts(input: {
    assetId: string;
    assetTimezone: string;
    fromDate: string;
    toDate: string;
  }): Promise<PublishedPostCandidate[]> {
    const since = new Date(
      localDayStartEpochSeconds(input.fromDate, input.assetTimezone) * 1000,
    );
    const until = new Date(
      localDayStartEpochSeconds(
        shiftCalendarDay(input.toDate, 1),
        input.assetTimezone,
      ) * 1000,
    );

    const rows = await this.dataSource.query<
      Array<{ external_publication_id: string; id: string }>
    >(
      `SELECT id, external_publication_id
         FROM social_publications
        WHERE asset_id = $1
          AND status = 'published'
          AND external_publication_id IS NOT NULL
          AND published_at >= $2
          AND published_at < $3`,
      [input.assetId, since, until],
    );

    return rows.map((row) => ({
      externalPublicationId: row.external_publication_id,
      publicationId: row.id,
    }));
  }
}
