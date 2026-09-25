import { Injectable, Logger } from '@nestjs/common';
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
  readPageSeriesByDate,
  normalizeFacebookPostLifetimeSnapshot,
  normalizeInstagramAccountInsights,
  normalizeInstagramMediaLifetimeSnapshot,
} from './meta-organic-insights.normalizer';
import {
  FACEBOOK_PAGE_ACCOUNT_METRICS,
  FACEBOOK_PAGE_SERIES_METRICS,
  FACEBOOK_POST_LIFETIME_METRICS,
  FACEBOOK_POST_REACTION_METRICS,
  INSTAGRAM_ACCOUNT_ENGAGEMENT_METRICS,
  INSTAGRAM_ACCOUNT_FOLLOW_METRICS,
  INSTAGRAM_ACCOUNT_MEDIA_METRICS,
  instagramMediaLifetimeMetrics,
} from './meta-organic-insights.types';

/**
 * The ceiling on posts discovered in one pass.
 *
 * Each discovered post costs one insights request, so an unbounded window on a
 * busy account would turn a sync into hundreds of calls against a shared quota.
 * 50 is a month of daily posting; beyond that the honest answer is a narrower
 * window, not a longer loop.
 */
const MAX_DISCOVERED_POSTS = 50;

/** A post/media candidate for a lifetime snapshot read, with its identity. */
type PublishedPostCandidate = {
  externalPublicationId: string;
  /** Lyra's publication row, when Lyra published it. Null otherwise. */
  publicationId: string | null;
  permalink: string | null;
  caption: string | null;
  mediaType: string | null;
  mediaProductType: string | null;
  publishedAt: Date | null;
};

@Injectable()
export class MetaOrganicInsightsService {
  private readonly logger = new Logger(MetaOrganicInsightsService.name);

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
      // Discovery source = the provider's own listing, bounded by the window
      // and by `MAX_DISCOVERED_POSTS`. It used to be `social_publications`
      // (Lyra-authored content only); see `discoverPublishedPosts` for why
      // that narrowing was lifted.
      const discovery = await this.discoverPublishedPosts({
        assetId: credential.assetId,
        assetTimezone,
        fromDate: input.fromDate,
        toDate: input.toDate,
        externalAssetId: credential.externalAssetId,
        accessToken: credential.accessToken,
        // The two the listing supports. Anything else already threw at the
        // provider check above, and the per-post loop below refuses again.
        assetType:
          credential.assetType === 'instagram_professional'
            ? 'instagram_professional'
            : 'facebook_page',
      });
      const candidatePosts = discovery.posts;
      apiCalls += discovery.apiCalls;

      for (const post of candidatePosts) {
        if (credential.assetType === 'facebook_page') {
          const insights = await this.graph.getOrganicInsights({
            objectId: post.externalPublicationId,
            accessToken: credential.accessToken,
            metrics: FACEBOOK_POST_LIFETIME_METRICS,
            period: 'lifetime',
            // Splits `post_media_view` into its ad and non-ad buckets. The
            // total is in the same response either way, so the split costs
            // nothing beyond the parameter.
            breakdown: 'is_from_ads',
          });
          apiCalls += insights.apiCalls;
          // A request of its own: the reaction map does not accept
          // `is_from_ads`, and asking for both under one breakdown makes Meta
          // refuse the whole thing — see `FACEBOOK_POST_REACTION_METRICS`.
          const reactions = await this.readPostReactions(
            post.externalPublicationId,
            credential.accessToken,
          );
          apiCalls += reactions.apiCalls;
          // Shares, comments and reactions are post *fields*, not metrics —
          // Meta has no `post_shares` insight. A second call, allowed to fail
          // on its own: losing it costs three columns, not the row.
          const engagement = await this.readPostEngagement(
            post.externalPublicationId,
            credential.accessToken,
          );
          apiCalls += engagement.apiCalls;
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
            permalink: post.permalink,
            caption: post.caption,
            mediaType: post.mediaType,
            mediaProductType: post.mediaProductType,
            publishedAt: post.publishedAt,
            insights,
            reactionInsights: reactions.data,
            engagementFields: engagement.data,
            observedAt: syncedAt,
          });
          if (row) postRows.push(row);
          else rowsSkipped += 1;
          continue;
        }

        if (credential.assetType === 'instagram_professional') {
          // The metric list is chosen per surface. Meta refuses the whole
          // request when one metric does not apply to the media's product type,
          // so a single list for every post meant every reel's call failed and
          // no reel ever reached the table — see
          // `INSTAGRAM_REEL_LIFETIME_METRICS`.
          const insights = await this.graph.getOrganicInsights({
            objectId: post.externalPublicationId,
            accessToken: credential.accessToken,
            metrics: instagramMediaLifetimeMetrics(post.mediaProductType),
            period: 'lifetime',
          });
          apiCalls += insights.apiCalls;
          const row = normalizeInstagramMediaLifetimeSnapshot({
            ...base,
            metricDate: currentDay,
            externalPublicationId: post.externalPublicationId,
            publicationId: post.publicationId,
            permalink: post.permalink,
            caption: post.caption,
            mediaType: post.mediaType,
            mediaProductType: post.mediaProductType,
            publishedAt: post.publishedAt,
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
        // A second call rather than more metrics on the first: that one carries
        // `breakdown=is_from_ads`, which none of these accept. Meta refuses the
        // whole request when one metric rejects the breakdown — this module has
        // been bitten by that twice — so the breakdown decides the split.
        //
        // Its own try/catch for the same reason the post reaction read has one:
        // these are an addition to a sync that already worked, and a Page that
        // refuses them should lose the series, not the day.
        const seriesInsights = await this.readPageSeries({
          credential,
          range,
        });
        apiCalls += insights.apiCalls + seriesInsights.apiCalls;
        const row = normalizeFacebookAccountInsights({
          ...base,
          metricDate,
          followersCount,
          insights,
          seriesInsights: seriesInsights.data,
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
        // The whole engagement family in one request: none of them takes a
        // breakdown, so Meta returns all eight from a single call and the cost
        // of the addition is one request per day rather than one per metric.
        const engagementInsights = await this.graph.getOrganicInsights({
          objectId: credential.externalAssetId,
          accessToken: credential.accessToken,
          metrics: INSTAGRAM_ACCOUNT_ENGAGEMENT_METRICS,
          period: 'day',
          metricType: 'total_value',
          ...range,
        });
        apiCalls +=
          mediaInsights.apiCalls +
          followInsights.apiCalls +
          engagementInsights.apiCalls;
        const row = normalizeInstagramAccountInsights({
          ...base,
          metricDate,
          followersCount,
          mediaInsights,
          followInsights,
          engagementInsights,
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

  /**
   * A Page post's reactions by emoji, or nothing.
   *
   * Its own call and its own try/catch, for the reason
   * `FACEBOOK_POST_REACTION_METRICS` documents: it cannot ride along with the
   * view read, and a refusal here should cost the six reaction columns rather
   * than the view total that already came back.
   */
  /**
   * Fills the Page follower series backwards, in one call for the whole window.
   *
   * ## Why this is not just a wider `sync()`
   *
   * `sync()` loops calendar days and spends two provider calls on each, because
   * the metrics it reads are per-day requests. Ninety days through that path is
   * a hundred and eighty calls against a quota shared with publishing, to
   * collect a series Meta will hand over in **one** request: these metrics
   * accept a range and answer with one entry per day inside it.
   *
   * So this is a separate, one-pass path rather than a raised limit on the
   * on-demand window, which is capped at seven days for exactly the reason
   * above and should stay capped.
   *
   * ## What it writes, and what it deliberately does not
   *
   * Only the four series columns. It does not touch `impressions`,
   * `followers_count` or anything the daily sync owns — the writer's COALESCE
   * means a row that already exists keeps every value it has and gains only
   * these. A day with no row yet gets one carrying just the series.
   *
   * `isPartial` is false for every day but today: these are settled historical
   * figures, which is the whole point of being able to ask for them.
   *
   * Returns the number of days written, or zero when the Page refuses — a
   * refusal here must not fail whatever called it, since the series is an
   * addition to a sync that already worked.
   */
  async backfillPageSeries(input: {
    resolved: ResolvedOrganicAnalyticsCredential;
    fromDate: string;
    toDate: string;
    /**
     * Required, not nullable: every account fact carries the run that produced
     * it, and a backfill writing rows with no provenance would leave the one
     * kind of row nobody could later trace or re-run.
     */
    syncRunId: string;
    syncedAt?: Date;
  }): Promise<{ daysWritten: number; apiCalls: number }> {
    const { credential, assetTimezone } = input.resolved;

    if (
      credential.provider !== 'meta' ||
      credential.assetType !== 'facebook_page'
    ) {
      throw new SocialOrganicSyncError('unsupported_analytics_asset_type');
    }

    const syncedAt = input.syncedAt ?? new Date();
    const currentDay = calendarDayIn(assetTimezone, syncedAt);
    const days = enumerateCalendarDays(input.fromDate, input.toDate);

    const series = await this.readPageSeries({
      credential,
      range: {
        since: localDayStartEpochSeconds(input.fromDate, assetTimezone),
        until:
          localDayStartEpochSeconds(
            shiftCalendarDay(input.toDate, 1),
            assetTimezone,
          ) - 1,
      },
    });

    if (series.data === undefined) {
      return { daysWritten: 0, apiCalls: series.apiCalls };
    }

    const byDate = readPageSeriesByDate(series.data, assetTimezone);
    const accountRows: NormalizedOrganicAccountMetricDaily[] = [];

    for (const metricDate of days) {
      const measured = byDate.get(metricDate);

      // No entry for this day means Meta reported nothing for it, which is not
      // a zero — a row of nulls would claim the Page had no followers.
      if (!measured) continue;

      accountRows.push({
        tenantId: credential.tenantId,
        workspaceId: credential.workspaceId,
        agencyClientId: credential.agencyClientId,
        assetId: credential.assetId,
        provider: credential.provider,
        source: 'organic',
        metricDate,
        assetTimezone,
        followersCount: null,
        followersGained: null,
        followersLost: null,
        impressions: null,
        reach: null,
        viewsTotal: null,
        reachTotal: null,
        profileViews: null,
        totalInteractions: null,
        accountsEngaged: null,
        likes: null,
        comments: null,
        shares: null,
        saves: null,
        replies: null,
        pageFollows: measured.pageFollows,
        pageDailyFollows: measured.pageDailyFollows,
        pageDailyUnfollows: measured.pageDailyUnfollows,
        viewsOrganic: null,
        viewsPaid: null,
        newConversations: measured.newConversations,
        isPartial: metricDate === currentDay,
        syncedAt,
        syncRunId: input.syncRunId,
        providerMetrics: {},
      });
    }

    await this.writer.upsert({ postRows: [], accountRows });

    this.logger.log(
      `Page series backfilled: ${JSON.stringify({
        assetId: credential.assetId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        daysWritten: accountRows.length,
      })}`,
    );

    return { daysWritten: accountRows.length, apiCalls: series.apiCalls };
  }

  /**
   * A Page's follower level, follow flows and new conversations for one day.
   *
   * Separate from the `page_media_view` read because that one carries
   * `breakdown=is_from_ads` and none of these accepts it. Its own try/catch
   * because it is an addition to a path that already worked: a Page that
   * refuses these — an older Page, a token without the messaging scope — should
   * lose the series columns and keep the day's views.
   */
  private async readPageSeries(input: {
    credential: { externalAssetId: string; accessToken: string };
    range: { since: number; until: number };
  }): Promise<{ data: unknown; apiCalls: number }> {
    try {
      const insights = await this.graph.getOrganicInsights({
        objectId: input.credential.externalAssetId,
        accessToken: input.credential.accessToken,
        metrics: FACEBOOK_PAGE_SERIES_METRICS,
        period: 'day',
        ...input.range,
      });

      return { data: insights, apiCalls: insights.apiCalls };
    } catch (error) {
      this.logger.warn(
        `Page ${input.credential.externalAssetId} series unavailable: ${String(error)}`,
      );
      // One call was still spent getting the refusal.
      return { data: undefined, apiCalls: 1 };
    }
  }

  private async readPostReactions(
    postId: string,
    accessToken: string,
  ): Promise<{ data: unknown; apiCalls: number }> {
    try {
      const insights = await this.graph.getOrganicInsights({
        objectId: postId,
        accessToken,
        metrics: FACEBOOK_POST_REACTION_METRICS,
        period: 'lifetime',
      });

      return { data: insights, apiCalls: insights.apiCalls };
    } catch (error) {
      this.logger.warn(
        `Post ${postId} reactions unavailable: ${String(error)}`,
      );
      // One call was still spent getting the refusal.
      return { data: undefined, apiCalls: 1 };
    }
  }

  /**
   * A Page post's shares, comments and reactions, or nothing.
   *
   * Its own try/catch because it is a second call for one post: a post whose
   * fields are refused should lose those three columns, not its whole row and
   * not the pass. The insights already read are the measurement that matters.
   */
  private async readPostEngagement(
    postId: string,
    accessToken: string,
  ): Promise<{ data: unknown; apiCalls: number }> {
    try {
      const fields = await this.graph.getPostEngagementFields({
        objectId: postId,
        accessToken,
      });

      return { data: fields.data, apiCalls: fields.apiCalls };
    } catch (error) {
      this.logger.warn(
        `Post ${postId} engagement fields unavailable: ${String(error)}`,
      );
      // One call was still spent getting the refusal.
      return { data: undefined, apiCalls: 1 };
    }
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
   * Every post the asset published in `[fromDate, toDate]`, from the provider.
   *
   * This used to read `social_publications` — content Lyra itself published —
   * and that was a deliberate, documented narrowing. It is widened here because
   * the question changed: a "best posts" table ranks what the audience actually
   * saw, and on this account that is 326 posts against one Lyra-published row.
   * Ranking the one would not be a smaller answer, it would be a wrong one.
   *
   * The window is passed to Meta rather than applied afterwards — both `/media`
   * and `/posts` honour `since`/`until` server-side — so the cost is one listing
   * call plus one insights call per post *in the window*, not per post on the
   * account. `MAX_DISCOVERED_POSTS` bounds a wide window.
   *
   * `publicationId` is still resolved, by joining back to `social_publications`
   * on the provider's id: a post Lyra published keeps its link to the
   * publication record, and one it did not simply has none.
   */
  private async discoverPublishedPosts(input: {
    assetId: string;
    assetTimezone: string;
    fromDate: string;
    toDate: string;
    externalAssetId: string;
    accessToken: string;
    assetType: 'facebook_page' | 'instagram_professional';
  }): Promise<{ posts: PublishedPostCandidate[]; apiCalls: number }> {
    const sinceEpoch = localDayStartEpochSeconds(
      input.fromDate,
      input.assetTimezone,
    );
    const untilEpoch = localDayStartEpochSeconds(
      shiftCalendarDay(input.toDate, 1),
      input.assetTimezone,
    );

    const listing = await this.graph.listPublishedPosts({
      objectId: input.externalAssetId,
      accessToken: input.accessToken,
      assetType: input.assetType,
      since: sinceEpoch,
      until: untilEpoch,
      limit: MAX_DISCOVERED_POSTS,
    });

    const candidates = listing.data.flatMap((entry) => {
      const parsed = parseDiscoveredPost(entry, input.assetType);
      return parsed ? [parsed] : [];
    });

    if (candidates.length === 0) {
      return { posts: [], apiCalls: listing.apiCalls };
    }

    // Lyra's own publication id, where one exists. A post published outside
    // Lyra simply has no row here, which is the ordinary case now that
    // discovery is provider-side.
    const owned = await this.dataSource.query<
      Array<{ external_publication_id: string; id: string }>
    >(
      `SELECT id, external_publication_id
         FROM social_publications
        WHERE asset_id = $1
          AND external_publication_id = ANY($2::text[])`,
      [input.assetId, candidates.map((post) => post.externalPublicationId)],
    );

    const publicationIds = new Map(
      owned.map((row) => [row.external_publication_id, row.id] as const),
    );

    return {
      posts: candidates.map((post) => ({
        ...post,
        publicationId: publicationIds.get(post.externalPublicationId) ?? null,
      })),
      apiCalls: listing.apiCalls,
    };
  }
}

/**
 * One entry of a provider listing, or null when it cannot be identified.
 *
 * Null rather than throwing: a listing is a page of many posts, and one entry
 * whose shape this build does not recognise should cost that post, not the
 * whole sync. The id is the only field that is genuinely required — everything
 * else is identity that a post may legitimately lack, such as a caption.
 */
function parseDiscoveredPost(
  entry: unknown,
  assetType: 'facebook_page' | 'instagram_professional',
): PublishedPostCandidate | null {
  if (typeof entry !== 'object' || entry === null) return null;

  const row = entry as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  if (!id) return null;

  const instagram = assetType === 'instagram_professional';
  const timestamp = instagram ? row.timestamp : row.created_time;
  const published = typeof timestamp === 'string' ? new Date(timestamp) : null;

  return {
    externalPublicationId: id,
    publicationId: null,
    permalink: readText(instagram ? row.permalink : row.permalink_url),
    caption: readText(instagram ? row.caption : row.message),
    mediaType: instagram ? readText(row.media_type) : null,
    mediaProductType: instagram ? readText(row.media_product_type) : null,
    publishedAt:
      published && !Number.isNaN(published.getTime()) ? published : null,
  };
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}
