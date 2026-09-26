import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { SocialOrganicAssetEntity } from '../entities/social-organic-asset.entity';
import { SocialOrganicAccountMetricDailyEntity } from './entities/social-organic-account-metric-daily.entity';
import { SocialOrganicPostMetricDailyEntity } from './entities/social-organic-post-metric-daily.entity';
import { SocialOrganicReachPeriodEntity } from './entities/social-organic-reach-period.entity';
import { SocialOrganicSyncRunEntity } from './entities/social-organic-sync-run.entity';
import {
  parseOrganicAnalyticsPeriod,
  shiftCalendarDay,
} from './social-organic-analytics-time';
import type { SocialOrganicAnalyticsAssetView } from './views/social-organic-analytics-asset.view';
import type {
  SocialOrganicAnalyticsOverviewView,
  SocialOrganicAnalyticsTotals,
} from './views/social-organic-analytics-overview.view';
import {
  emptyOrganicSeriesPoint,
  type SocialOrganicAnalyticsSeriesView,
  type SocialOrganicSeriesPoint,
} from './views/social-organic-analytics-series.view';
import type { SocialOrganicAnalyticsFreshnessView } from './views/social-organic-analytics-freshness.view';
import {
  socialOrganicSurfaceSpellings,
  toSocialOrganicTopPostView,
  type SocialOrganicPostSurface,
  type SocialOrganicTopPostSort,
  type SocialOrganicTopPostView,
  type SocialOrganicTopPostsView,
} from './views/social-organic-top-posts.view';
import {
  toSocialOrganicPublicationMetricsView,
  type SocialOrganicPublicationMetricsView,
} from './views/social-organic-publication-metrics.view';
import type {
  SocialOrganicTopStoriesView,
  SocialOrganicTopStorySort,
  SocialOrganicTopStoryView,
} from './views/social-organic-top-stories.view';
import { SocialOrganicStoryEntity } from './entities/social-organic-story.entity';
import {
  toSocialOrganicFacebookReelView,
  type SocialOrganicFacebookReelSort,
  type SocialOrganicFacebookReelView,
  type SocialOrganicFacebookReelsView,
} from './views/social-organic-facebook-reels.view';
import { SocialOrganicFacebookReelEntity } from './entities/social-organic-facebook-reel.entity';
import {
  emptyWeekdayBucket,
  pickBestWeekday,
  WEEKDAY_ORDER,
  type SocialOrganicWeekdayView,
} from './views/social-organic-weekday.view';

export type SocialOrganicAnalyticsScope = {
  tenantId: string;
  workspaceId: string;
  /** NULL means agency context: the agency's own assets. */
  agencyClientId: string | null;
  companyContextId?: string | null;
};

export type SocialOrganicAnalyticsOverviewInput =
  SocialOrganicAnalyticsScope & {
    assetId: string;
    since: string;
    until: string;
  };

export type SocialOrganicAnalyticsFreshnessInput =
  SocialOrganicAnalyticsScope & {
    assetId: string;
  };

export type SocialOrganicPublicationMetricsInput =
  SocialOrganicAnalyticsScope & {
    publicationIds: string[];
  };

/**
 * What `countPublications` answers.
 *
 * Counts and sums over stored rows, never provider measurements — which is why
 * every field is a string rather than a nullable one. Zero here means the table
 * holds nothing for the window, and that is a real answer.
 */
type PublicationCounts = {
  /**
   * Every post published in the window, whatever its surface.
   *
   * Not `reels + pagePosts`: those two count different assets on different
   * networks and neither covers an Instagram feed post. This is the one figure
   * that answers "quantas postagens", which the summary block asks for and
   * which nothing else in the read model could produce — the metric existed in
   * the catalog with no source behind it, so its card rendered a dash.
   *
   * By publish date, like `reels` and `stories` below, and `DISTINCT` because
   * the fact table holds one row per post per observation day.
   */
  publications: string;
  reels: string;
  stories: string;
  pageReactions: string;
  pageComments: string;
  pageShares: string;
  pagePosts: string;
  pageReels: string;
  pageReelPlays: string;
  pageReelViewers: string;
  pageReelWatchTimeSeconds: string;
  pageReelReactions: string;
  pageReelComments: string;
  pageReelShares: string;
};

/** The Facebook reel aggregate, all columns as text. */
type FacebookReelAggregateRow = {
  count: string | null;
  plays: string | null;
  viewers: string | null;
  watch_time_ms: string | null;
  reactions: string | null;
  comments: string | null;
  shares: string | null;
};

/** The Facebook engagement aggregate, all columns as text. */
type PageAggregateRow = {
  reactions: string | null;
  comments: string | null;
  shares: string | null;
  posts: string | null;
};

/** The raw shape one aggregation query returns, all columns as text. */
type AggregateRow = {
  impressions: string | null;
  reach: string | null;
  reach_days: string | null;
  fact_days: string | null;
  partial_days: string | null;
  followers_gained: string | null;
  followers_lost: string | null;
  profile_views: string | null;
  total_interactions: string | null;
  likes: string | null;
  comments: string | null;
  shares: string | null;
  saves: string | null;
  replies: string | null;
  /**
   * Summed for completeness, and paired with the count of days that reported
   * it so the reader can refuse to present the sum as a period figure.
   *
   * `accounts_engaged` counts DISTINCT ACCOUNTS WITHIN ONE DAY. Adding seven
   * days of it counts a person who engaged every day seven times, which is the
   * same class of error as summing reach — see `readReach`.
   */
  accounts_engaged: string | null;
  accounts_engaged_days: string | null;
};

/**
 * Every read the organic analytics dashboard makes.
 *
 * Mirrors `SocialAnalyticsReadService` (the paid module's read service)
 * closely: it never speaks to a provider, reads only
 * `social_organic_account_metrics_daily`/`social_organic_sync_runs`/
 * `social_organic_assets`, and is deliberately not built on
 * `SocialOrganicCredentialResolver` or `SocialOrganicSyncRunService` — both
 * are credential-capable or mutate state, and a stale/disconnected asset's
 * stored history is still real and still worth reading.
 */
@Injectable()
export class SocialOrganicAnalyticsReadService {
  constructor(
    @InjectRepository(SocialOrganicAssetEntity, 'agency')
    private readonly assetsRepository: Repository<SocialOrganicAssetEntity>,
    @InjectRepository(SocialOrganicAccountMetricDailyEntity, 'agency')
    private readonly metricsRepository: Repository<SocialOrganicAccountMetricDailyEntity>,
    @InjectRepository(SocialOrganicPostMetricDailyEntity, 'agency')
    private readonly postMetricsRepository: Repository<SocialOrganicPostMetricDailyEntity>,
    @InjectRepository(SocialOrganicSyncRunEntity, 'agency')
    private readonly runsRepository: Repository<SocialOrganicSyncRunEntity>,
    /**
     * The period-reach measurement cache. Read-only here: measurements are
     * taken by the sync worker, never by a dashboard load, so opening a report
     * never spends provider quota.
     */
    @InjectRepository(SocialOrganicReachPeriodEntity, 'agency')
    private readonly reachPeriodsRepository: Repository<SocialOrganicReachPeriodEntity>,
    /**
     * Captured stories. Read-only here too, and for a stronger reason than the
     * cache above: this table cannot be rebuilt from the provider, so a read
     * path must never be in a position to write to it.
     */
    @InjectRepository(SocialOrganicStoryEntity, 'agency')
    private readonly storiesRepository: Repository<SocialOrganicStoryEntity>,
    @InjectRepository(SocialOrganicFacebookReelEntity, 'agency')
    private readonly facebookReelsRepository: Repository<SocialOrganicFacebookReelEntity>,
  ) {}

  /**
   * The organic assets this caller may report on, for the dashboard's picker.
   *
   * `social/organic/connections` is admin-gated
   * (`social.settings.integrations.manage.admin`), so an operational-tier
   * reader needs its own, strictly-narrower read — same reasoning
   * `SocialAnalyticsReadService.listConnections` documents for paid. No
   * status filter: a revoked asset's stored history is still real.
   */
  async listAssets(
    input: SocialOrganicAnalyticsScope,
  ): Promise<SocialOrganicAnalyticsAssetView[]> {
    const assets = await this.assetsRepository.find({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agencyClientId: input.agencyClientId ?? IsNull(),
        companyContextId: input.companyContextId ?? IsNull(),
      },
      select: [
        'id',
        'provider',
        'assetType',
        'displayName',
        'username',
        'avatarUrl',
        'status',
        'assetTimezone',
      ],
      order: { displayName: 'ASC', createdAt: 'ASC' },
    });

    return assets.map((asset) => ({
      id: asset.id,
      provider: asset.provider,
      assetType: asset.assetType,
      displayName: asset.displayName,
      username: asset.username,
      avatarUrl: asset.avatarUrl,
      status: asset.status,
      assetTimezone: asset.assetTimezone,
    }));
  }

  /**
   * Totals for one organic asset and period. No comparison period, no KPI
   * derivation beyond what `SocialOrganicAnalyticsTotals` documents — this
   * first pass of A3 reads only the account grain, which has no
   * engagement-rate inputs (see the view's docblock).
   */
  async overview(
    input: SocialOrganicAnalyticsOverviewInput,
  ): Promise<SocialOrganicAnalyticsOverviewView> {
    const period = this.parsePeriod(input);
    const asset = await this.findAssetInScope(input);

    const [aggregate, followersCount, lastFactDate, periodReach, counts] =
      await Promise.all([
        this.aggregate(asset.id, period.since, period.until),
        this.readFollowersCountStock(asset.id, period.since, period.until),
        this.findLastFactDate(asset.id),
        // From the measurement cache, never from the daily rows: no expression
        // over them produces this number, because the duplicates it removes
        // were resolved inside Meta.
        this.findPeriodReach(asset.id, period.since, period.until),
        // Counted here rather than cached with the measurement, so the answer
        // follows the period actually asked for instead of being pinned to one
        // of the four windows the sync pre-measures.
        this.countPublications(asset.id, period.since, period.until),
      ]);

    return {
      assetId: asset.id,
      timezone: asset.assetTimezone ?? '',
      period: { since: period.since, until: period.until },
      totals: this.toTotals(aggregate, followersCount, periodReach, counts),
      hasPartialData: toCount(aggregate.partial_days) > 0n,
      lastFactDate,
    };
  }

  /**
   * How many reels and stories the asset published in the window.
   *
   * Two sources because the two surfaces are stored differently, and they are
   * stored differently because Meta treats them differently — see the stories
   * entity. Reels are counted distinctly from the post facts, which carry one
   * row per observation day, so a reel observed on five days must not count
   * five times.
   *
   * Both counts are by **publish date**, not observation date: "quantos reels
   * no período" asks what was published then, and a reel published in August
   * and re-observed in September belongs to August.
   */
  private async countPublications(
    assetId: string,
    since: string,
    until: string,
  ): Promise<PublicationCounts> {
    const reelSpellings = socialOrganicSurfaceSpellings('reel');

    const [publications, reels, stories, page, pageReels] = await Promise.all([
      // Every surface, unlike the reel count below it: no `media_product_type`
      // filter, because a post with none recorded is still a post.
      this.postMetricsRepository.query<Array<{ count: string }>>(
        `SELECT COUNT(DISTINCT external_publication_id)::text AS count
           FROM social_organic_post_metrics_daily
          WHERE asset_id = $1
            AND published_at IS NOT NULL
            AND (published_at AT TIME ZONE asset_timezone)::date
                BETWEEN $2::date AND $3::date`,
        [assetId, since, until],
      ),
      this.postMetricsRepository.query<Array<{ count: string }>>(
        `SELECT COUNT(DISTINCT external_publication_id)::text AS count
           FROM social_organic_post_metrics_daily
          WHERE asset_id = $1
            AND published_at IS NOT NULL
            AND (published_at AT TIME ZONE asset_timezone)::date
                BETWEEN $2::date AND $3::date
            AND UPPER(media_product_type) = ANY($4::text[])`,
        [assetId, since, until, reelSpellings],
      ),
      this.storiesRepository.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count
           FROM social_organic_stories
          WHERE asset_id = $1
            AND published_at IS NOT NULL
            AND published_at::date BETWEEN $2::date AND $3::date`,
        [assetId, since, until],
      ),
      // The Facebook Page engagement totals, summed from the post facts rather
      // than read from an account metric. Meta's `page_post_engagements` exists
      // but lumps reactions, comments, shares and clicks into one number that
      // cannot be split back into the three the operator asked for.
      //
      // `DISTINCT ON` first, because the post fact has one row per observation
      // day: summing the table directly would count a post observed five times
      // five times over. The subquery takes each post's newest row, and the
      // outer query adds those.
      this.postMetricsRepository.query<Array<PageAggregateRow>>(
        `SELECT COALESCE(SUM(reactions_total), 0)::text AS reactions,
                COALESCE(SUM(comments_lifetime), 0)::text AS comments,
                COALESCE(SUM(shares_lifetime), 0)::text AS shares,
                COUNT(*)::text AS posts
           FROM (
             SELECT DISTINCT ON (external_publication_id)
                    reactions_total, comments_lifetime, shares_lifetime
               FROM social_organic_post_metrics_daily
              WHERE asset_id = $1
                AND published_at IS NOT NULL
                AND (published_at AT TIME ZONE asset_timezone)::date
                    BETWEEN $2::date AND $3::date
              ORDER BY external_publication_id, metric_date DESC, synced_at DESC
           ) AS latest`,
        [assetId, since, until],
      ),
      // The reel aggregates, summed over the reels published in the window.
      //
      // `unique_viewers` is summed with the others and it is the one figure
      // here that overstates: Meta reports it per reel and offers no
      // de-duplicated union, so an account that watched two reels is counted
      // twice. The alternative is no card at all, since this is the only
      // unique-viewer figure left on the Facebook side. The catalog's
      // description says so in the operator's own words rather than leaving
      // them to assume it is a distinct-people count.
      this.facebookReelsRepository.query<Array<FacebookReelAggregateRow>>(
        `SELECT COUNT(*)::text AS count,
                COALESCE(SUM(plays), 0)::text AS plays,
                COALESCE(SUM(unique_viewers), 0)::text AS viewers,
                COALESCE(SUM(total_watch_time_ms), 0)::text AS watch_time_ms,
                COALESCE(SUM(reactions_total), 0)::text AS reactions,
                COALESCE(SUM(comments), 0)::text AS comments,
                COALESCE(SUM(shares), 0)::text AS shares
           FROM social_organic_facebook_reels
          WHERE asset_id = $1
            AND published_at IS NOT NULL
            AND published_at::date BETWEEN $2::date AND $3::date`,
        [assetId, since, until],
      ),
    ]);

    return {
      publications: publications[0]?.count ?? '0',
      reels: reels[0]?.count ?? '0',
      stories: stories[0]?.count ?? '0',
      pageReactions: page[0]?.reactions ?? '0',
      pageComments: page[0]?.comments ?? '0',
      pageShares: page[0]?.shares ?? '0',
      pagePosts: page[0]?.posts ?? '0',
      pageReels: pageReels[0]?.count ?? '0',
      pageReelPlays: pageReels[0]?.plays ?? '0',
      pageReelViewers: pageReels[0]?.viewers ?? '0',
      // Milliseconds in the column, seconds on the card: a total watch time in
      // milliseconds is a number nobody reads, and the conversion belongs where
      // the unit is decided rather than in each consumer.
      pageReelWatchTimeSeconds: String(
        BigInt(pageReels[0]?.watch_time_ms ?? '0') / 1000n,
      ),
      pageReelReactions: pageReels[0]?.reactions ?? '0',
      pageReelComments: pageReels[0]?.comments ?? '0',
      pageReelShares: pageReels[0]?.shares ?? '0',
    };
  }

  /**
   * One point per calendar day of the period, ascending, continuous — a day
   * the read model never observed carries `hasData: false` with nulls,
   * mirroring paid's `timeseries` exactly for the same reason: a chart cannot
   * otherwise tell "no delivery" from "never synced".
   */
  async timeseries(
    input: SocialOrganicAnalyticsOverviewInput,
  ): Promise<SocialOrganicAnalyticsSeriesView> {
    const period = this.parsePeriod(input);
    const asset = await this.findAssetInScope(input);

    const rows = await this.metricsRepository
      .createQueryBuilder('fact')
      .select(`to_char(fact.metric_date, 'YYYY-MM-DD')`, 'metric_date')
      .addSelect('SUM(fact.impressions)', 'impressions')
      .addSelect('SUM(fact.reach)', 'reach')
      .addSelect('COUNT(fact.reach)', 'reach_days')
      .addSelect('MAX(fact.followers_count)', 'followers_count')
      .addSelect('SUM(fact.followers_gained)', 'followers_gained')
      .addSelect('SUM(fact.followers_lost)', 'followers_lost')
      .addSelect('SUM(fact.profile_views)', 'profile_views')
      // Engagement columns only exist from 2026-09-23 (migration
      // 1795600000000) and are nullable with no default. SUM over a day that
      // predates collection returns NULL, and that NULL is carried through to
      // the point rather than coerced to "0": a gap in collection must draw as
      // a break in the line, not as a day nobody interacted.
      .addSelect('SUM(fact.total_interactions)', 'total_interactions')
      .addSelect('SUM(fact.likes)', 'likes')
      .addSelect('SUM(fact.comments)', 'comments')
      .addSelect('SUM(fact.shares)', 'shares')
      .addSelect('SUM(fact.saves)', 'saves')
      .addSelect('SUM(fact.replies)', 'replies')
      .addSelect('SUM(fact.accounts_engaged)', 'accounts_engaged')
      // MAX, not SUM: `page_follows` is a STOCK — the follower level at the end
      // of the day — and the grouping here is already one day, so MAX is just
      // "the value for this day". Summing it would add levels together and
      // produce a growth line climbing by the whole audience every day.
      .addSelect('MAX(fact.page_follows)', 'page_follows')
      .addSelect('SUM(fact.page_daily_follows)', 'page_daily_follows')
      .addSelect('SUM(fact.page_daily_unfollows)', 'page_daily_unfollows')
      .addSelect('SUM(fact.views_organic)', 'views_organic')
      .addSelect('SUM(fact.views_paid)', 'views_paid')
      .addSelect('SUM(fact.new_conversations)', 'new_conversations')
      .addSelect('bool_or(fact.is_partial)', 'is_partial')
      .where('fact.asset_id = :assetId', { assetId: asset.id })
      .andWhere('fact.metric_date BETWEEN :since AND :until', {
        since: period.since,
        until: period.until,
      })
      .groupBy('fact.metric_date')
      .orderBy('fact.metric_date', 'ASC')
      .getRawMany<{
        metric_date: string;
        impressions: string | null;
        reach: string | null;
        reach_days: string | null;
        followers_count: string | null;
        followers_gained: string | null;
        followers_lost: string | null;
        profile_views: string | null;
        total_interactions: string | null;
        likes: string | null;
        comments: string | null;
        shares: string | null;
        saves: string | null;
        replies: string | null;
        accounts_engaged: string | null;
        page_follows: string | null;
        page_daily_follows: string | null;
        page_daily_unfollows: string | null;
        views_organic: string | null;
        views_paid: string | null;
        new_conversations: string | null;
        is_partial: boolean;
      }>();

    const byDate = new Map(rows.map((row) => [row.metric_date, row]));
    const points: SocialOrganicSeriesPoint[] = [];

    for (
      let day = period.since;
      day <= period.until;
      day = shiftCalendarDay(day, 1)
    ) {
      const row = byDate.get(day);

      if (!row) {
        points.push(emptyOrganicSeriesPoint(day));
        continue;
      }

      points.push({
        date: day,
        hasData: true,
        impressions: toCount(row.impressions).toString(),
        // This day's own reach, never a sum across days — see the entity
        // docblock. Safe to return directly here because the grain is one
        // day, which is the grain Meta reported it at.
        reach:
          toCount(row.reach_days) > 0n ? toCount(row.reach).toString() : null,
        followersCount:
          row.followers_count === null
            ? null
            : toCount(row.followers_count).toString(),
        followersGained: toCount(row.followers_gained).toString(),
        followersLost: toCount(row.followers_lost).toString(),
        profileViews: toCount(row.profile_views).toString(),
        totalInteractions: readNullableCount(row.total_interactions),
        likes: readNullableCount(row.likes),
        comments: readNullableCount(row.comments),
        shares: readNullableCount(row.shares),
        saves: readNullableCount(row.saves),
        replies: readNullableCount(row.replies),
        accountsEngaged: readNullableCount(row.accounts_engaged),
        pageFollows: readNullableCount(row.page_follows),
        pageDailyFollows: readNullableCount(row.page_daily_follows),
        pageDailyUnfollows: readNullableCount(row.page_daily_unfollows),
        viewsOrganic: readNullableCount(row.views_organic),
        viewsPaid: readNullableCount(row.views_paid),
        newConversations: readNullableCount(row.new_conversations),
        isPartial: row.is_partial === true,
      });
    }

    return {
      assetId: asset.id,
      timezone: asset.assetTimezone ?? '',
      period: { since: period.since, until: period.until },
      seriesMode: 'continuous',
      points,
      observedDays: rows.length,
      hasPartialData: rows.some((row) => row.is_partial),
    };
  }

  /**
   * How current this asset's read model is.
   *
   * Queries `SocialOrganicSyncRunEntity` directly, never through
   * `SocialOrganicSyncRunService` — same reasoning as paid's freshness read:
   * a read endpoint must not hold a credential-capable dependency, and must
   * enqueue nothing. `runs` is split by `run_kind` ('manual' | 'scheduled'),
   * organic's actual vocabulary — not a copy of paid's `daily`/`intraday`
   * shape, which describes a different pipeline. No `backfill` section:
   * organic has no chunked-backfill planner.
   */
  async freshness(
    input: SocialOrganicAnalyticsFreshnessInput,
  ): Promise<SocialOrganicAnalyticsFreshnessView> {
    const asset = await this.findAssetInScope(input);

    const [metrics, scheduledRun, manualRun] = await Promise.all([
      this.readMetricsFreshness(asset.id),
      this.findLatestSuccessfulRun(asset.id, 'scheduled'),
      this.findLatestSuccessfulRun(asset.id, 'manual'),
    ]);

    return {
      assetId: asset.id,
      timezone: asset.assetTimezone ?? '',
      metrics,
      runs: {
        latestSuccessfulScheduledRun: scheduledRun,
        latestSuccessfulManualRun: manualRun,
      },
      hasPartialData: metrics.latestPartialMetricDate !== null,
    };
  }

  /**
   * Latest observation for each requested local publication in the caller's
   * exact scope. A missing id intentionally looks the same as an out-of-scope
   * id: returning no item avoids turning this route into an enumeration oracle.
   *
   * This query takes one newest fact, never aggregates post rows. In
   * particular, the entity's provider lifetime snapshots must never be added
   * across sync days and reach is non-additive across days.
   */
  async publicationMetrics(
    input: SocialOrganicPublicationMetricsInput,
  ): Promise<SocialOrganicPublicationMetricsView[]> {
    const publicationIds = [...new Set(input.publicationIds)];
    if (!publicationIds.length) return [];

    const facts = await this.postMetricsRepository
      .createQueryBuilder('fact')
      .innerJoin('social_organic_assets', 'asset', 'asset.id = fact.asset_id')
      .distinctOn(['fact.publicationId'])
      .where('fact.tenantId = :tenantId', { tenantId: input.tenantId })
      .andWhere('fact.workspaceId = :workspaceId', {
        workspaceId: input.workspaceId,
      })
      .andWhere('fact.publicationId IN (:...publicationIds)', {
        publicationIds,
      })
      .andWhere('fact.publicationId IS NOT NULL')
      .andWhere(
        input.agencyClientId === null
          ? 'fact.agencyClientId IS NULL'
          : 'fact.agencyClientId = :agencyClientId',
        input.agencyClientId === null
          ? {}
          : { agencyClientId: input.agencyClientId },
      )
      .andWhere(
        'asset.company_context_id IS NOT DISTINCT FROM :companyContextId',
        { companyContextId: input.companyContextId },
      )
      .orderBy('fact.publicationId', 'ASC')
      .addOrderBy('fact.metricDate', 'DESC')
      .addOrderBy('fact.syncedAt', 'DESC')
      .getMany();

    return facts.map(toSocialOrganicPublicationMetricsView);
  }

  /**
   * The asset's posts, ranked by one lifetime counter.
   *
   * `DISTINCT ON (external_publication_id)` because the table keeps one row per
   * post **per day a sync observed it**: a post read on five days has five
   * rows, all of them cumulative totals of the same post. Summing them would
   * multiply the post by the number of times it was looked at, so the ranking
   * takes the newest observation of each and orders those.
   *
   * The two-step shape — pick the latest row per post, then sort that set — is
   * what makes it correct. Sorting first and de-duplicating afterwards would
   * rank yesterday's snapshot of one post against today's of another.
   *
   * The window filters on `published_at`, not on `metric_date`: the operator is
   * asking which posts *published* in this period did best, and `metric_date`
   * is merely when Lyra last looked.
   *
   * ## Narrowing to one surface
   *
   * `surface` splits the ranking into "Postagens", "Reels" and "Stories", which
   * are three different questions — a reel's reach and a feed image's are not
   * compared by anybody who understands either. It filters inside the same
   * query as everything else, which matters: `media_product_type` is a property
   * of the post and so is identical on all of its rows, but applying the filter
   * *after* `DISTINCT ON` picked the newest row would still be a different
   * statement, and one that quietly breaks the day a post's surface is
   * backfilled onto some of its rows and not others.
   *
   * A row whose `media_product_type` is null matches no surface at all. That is
   * deliberate: the column is nullable and older rows predate it being
   * collected, and guessing that an unknown surface is a feed post would put
   * stories into the posts table with no way for a reader to tell.
   */
  async topPosts(
    input: SocialOrganicAnalyticsScope & {
      assetId: string;
      since: string;
      until: string;
      sort?: SocialOrganicTopPostSort;
      surface?: SocialOrganicPostSurface;
      limit?: number;
    },
  ): Promise<SocialOrganicTopPostsView> {
    const period = this.parsePeriod({ since: input.since, until: input.until });
    // Proves the asset is in scope before any fact is read, and throws the same
    // "not found" an unknown id gets.
    const asset = await this.findAssetInScope(input);

    const sort = input.sort ?? 'reach';
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);

    const latestPerPost = this.postMetricsRepository
      .createQueryBuilder('fact')
      .distinctOn(['fact.externalPublicationId'])
      .where('fact.assetId = :assetId', { assetId: asset.id })
      .andWhere('fact.tenantId = :tenantId', { tenantId: input.tenantId })
      .andWhere('fact.workspaceId = :workspaceId', {
        workspaceId: input.workspaceId,
      })
      .andWhere(
        input.agencyClientId === null
          ? 'fact.agencyClientId IS NULL'
          : 'fact.agencyClientId = :agencyClientId',
        input.agencyClientId === null
          ? {}
          : { agencyClientId: input.agencyClientId },
      )
      // A post with no publish date cannot be placed in the window, so it is
      // left out rather than assumed to belong to it.
      .andWhere('fact.publishedAt IS NOT NULL')
      .andWhere('fact.publishedAt >= :since', {
        since: `${period.since}T00:00:00Z`,
      })
      .andWhere('fact.publishedAt < :until', {
        until: `${shiftCalendarDay(period.until, 1)}T00:00:00Z`,
      })
      .orderBy('fact.externalPublicationId', 'ASC')
      .addOrderBy('fact.metricDate', 'DESC')
      .addOrderBy('fact.syncedAt', 'DESC');

    if (input.surface) {
      // `UPPER(...) IN (...)` rather than an equality: one surface answers to
      // several of Meta's spellings — see `socialOrganicSurfaceSpellings`. The
      // list is closed and comes from the module's own constant, never from the
      // request, which is what makes interpolating it unnecessary: it is still
      // bound as a parameter.
      latestPerPost.andWhere(
        'UPPER(fact.mediaProductType) IN (:...surfaceSpellings)',
        { surfaceSpellings: socialOrganicSurfaceSpellings(input.surface) },
      );
    }

    const facts = await latestPerPost.getMany();

    const items = facts.map(toSocialOrganicTopPostView);

    items.sort((a, b) => compareTopPosts(a, b, sort));

    return { items: items.slice(0, limit), total: items.length };
  }

  /**
   * Publishing performance by day of the week.
   *
   * Built from the same `DISTINCT ON` the ranking uses, for the same reason: the
   * post table holds one row per observation day, and a post observed on five
   * days would otherwise be counted five times — which would make the weekday a
   * post was *read* on matter as much as the one it was published on.
   *
   * The weekday comes from `published_at` rendered in the asset's own timezone.
   * Without the cast, a post published at 21:00 in São Paulo is a Tuesday to
   * Postgres and a Monday to the operator who wrote it, and the card would
   * quietly recommend the wrong day.
   */
  async weekdayPerformance(
    input: SocialOrganicAnalyticsScope & {
      assetId: string;
      since: string;
      until: string;
    },
  ): Promise<SocialOrganicWeekdayView> {
    const period = this.parsePeriod({ since: input.since, until: input.until });
    const asset = await this.findAssetInScope(input);
    const timezone = asset.assetTimezone ?? 'UTC';

    const latestPerPost = this.postMetricsRepository
      .createQueryBuilder('fact')
      .distinctOn(['fact.externalPublicationId'])
      .select('fact.externalPublicationId', 'external_publication_id')
      .addSelect('fact.publishedAt', 'published_at')
      // The lifetime view total where it exists, falling back to the daily
      // impressions column. A Page post reports the first; older rows, and
      // Instagram, have only the second.
      .addSelect(
        'COALESCE(fact.impressions_lifetime, fact.impressions)',
        'views',
      )
      .where('fact.assetId = :assetId', { assetId: asset.id })
      .andWhere('fact.tenantId = :tenantId', { tenantId: input.tenantId })
      .andWhere('fact.workspaceId = :workspaceId', {
        workspaceId: input.workspaceId,
      })
      .andWhere(
        input.agencyClientId === null
          ? 'fact.agencyClientId IS NULL'
          : 'fact.agencyClientId = :agencyClientId',
        input.agencyClientId === null
          ? {}
          : { agencyClientId: input.agencyClientId },
      )
      .andWhere('fact.publishedAt IS NOT NULL')
      .andWhere('fact.publishedAt >= :since', {
        since: `${period.since}T00:00:00Z`,
      })
      .andWhere('fact.publishedAt < :until', {
        until: `${shiftCalendarDay(period.until, 1)}T00:00:00Z`,
      })
      .orderBy('fact.externalPublicationId', 'ASC')
      .addOrderBy('fact.metricDate', 'DESC')
      .addOrderBy('fact.syncedAt', 'DESC');

    const rows = await this.postMetricsRepository.manager
      .createQueryBuilder()
      .select(
        'EXTRACT(ISODOW FROM latest.published_at AT TIME ZONE :zone)',
        'weekday',
      )
      .addSelect('COUNT(*)', 'publications')
      .addSelect('SUM(latest.views)', 'total')
      .from(`(${latestPerPost.getQuery()})`, 'latest')
      .setParameters({ ...latestPerPost.getParameters(), zone: timezone })
      .groupBy('1')
      .getRawMany<{
        weekday: string;
        publications: string;
        total: string | null;
      }>();

    const byWeekday = new Map(rows.map((row) => [Number(row.weekday), row]));

    const buckets = WEEKDAY_ORDER.map((weekday) => {
      const row = byWeekday.get(weekday);

      if (!row) return emptyWeekdayBucket(weekday);

      const publications = Number(row.publications);
      const total = row.total === null ? null : toCount(row.total).toString();

      return {
        weekday,
        publications,
        total,
        // Null when no post on this weekday reported views at all — an average
        // of zero would draw as the worst day rather than as no evidence.
        average:
          total === null || publications === 0
            ? null
            : (Number(total) / publications).toFixed(1),
      };
    });

    return {
      assetId: asset.id,
      timezone: asset.assetTimezone ?? '',
      period: { since: period.since, until: period.until },
      buckets,
      bestWeekday: pickBestWeekday(buckets),
    };
  }

  /**
   * The best stories of a period, as the two-column panel renders them.
   *
   * ## Why it does not go through `topPosts`
   *
   * `topPosts` reads `social_organic_post_metrics_daily`, which has one row per
   * observation day and needs `DISTINCT ON` to pick the newest. The stories
   * table has one row per story — a story's counters are overwritten in place
   * as it moves through its day, because there is no history worth keeping
   * between two readings an hour apart — so there is nothing to de-duplicate
   * and no `metricDate` to order by.
   *
   * The deeper reason is that they are not the same kind of record. A post fact
   * is a cache of something re-readable; a story row is the only evidence that
   * the story existed. Sharing a query would eventually mean sharing a
   * retention or a rebuild policy, and those must not be shared.
   *
   * ## The ranking is honest about what it cannot see
   *
   * Only stories the hourly collector caught are here. A story posted and
   * expired between two passes is absent, not zero — which is why the panel's
   * empty state has to say "no stories captured" rather than "no stories".
   */
  async topStories(
    input: SocialOrganicAnalyticsScope & {
      assetId: string;
      since: string;
      until: string;
      sort?: SocialOrganicTopStorySort;
      limit?: number;
    },
  ): Promise<SocialOrganicTopStoriesView> {
    const period = this.parsePeriod({ since: input.since, until: input.until });
    const asset = await this.findAssetInScope(input);

    const sort = input.sort ?? 'views';
    // The panel shows five; the cap is higher so a caller can ask for more
    // without a new endpoint, and low enough that a creative-heavy response
    // cannot become a page of its own.
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 50);

    const rows = await this.storiesRepository
      .createQueryBuilder('story')
      .where('story.assetId = :assetId', { assetId: asset.id })
      .andWhere('story.tenantId = :tenantId', { tenantId: input.tenantId })
      .andWhere('story.workspaceId = :workspaceId', {
        workspaceId: input.workspaceId,
      })
      .andWhere(
        input.agencyClientId === null
          ? 'story.agencyClientId IS NULL'
          : 'story.agencyClientId = :agencyClientId',
        input.agencyClientId === null
          ? {}
          : { agencyClientId: input.agencyClientId },
      )
      // A story with no publish time cannot be placed in the window. It should
      // not happen — the listing always carries a timestamp — but leaving it
      // out is better than assuming it belongs here.
      .andWhere('story.publishedAt IS NOT NULL')
      .andWhere('story.publishedAt >= :since', {
        since: `${period.since}T00:00:00Z`,
      })
      .andWhere('story.publishedAt < :until', {
        until: `${shiftCalendarDay(period.until, 1)}T00:00:00Z`,
      })
      .getMany();

    const items = rows.map(toSocialOrganicTopStoryView);

    items.sort((a, b) => compareTopStories(a, b, sort));

    return { items: items.slice(0, limit), total: items.length };
  }

  /**
   * The best Facebook reels of a period.
   *
   * ## Why it does not go through `topPosts`
   *
   * A Page reel is on none of the edges `topPosts` reads. It is absent from
   * `/{page}/posts` and answers nothing on `/{post}/insights`, so it never
   * reaches `social_organic_post_metrics_daily` at all — it has a table of its
   * own, filled by a collector of its own.
   *
   * The measurements differ too, not just the plumbing. A Facebook reel reports
   * plays, replays and unique viewers where an Instagram one reports views,
   * reach and saves. Serving both through one shape would put two different
   * things in one column and invite a comparison that means nothing.
   *
   * Unlike `topStories`, this ranking is complete: a reel is permanent, so
   * every reel published in the window is here once a pass has seen it.
   */
  async facebookReels(
    input: SocialOrganicAnalyticsScope & {
      assetId: string;
      since: string;
      until: string;
      sort?: SocialOrganicFacebookReelSort;
      limit?: number;
    },
  ): Promise<SocialOrganicFacebookReelsView> {
    const period = this.parsePeriod({ since: input.since, until: input.until });
    const asset = await this.findAssetInScope(input);

    const sort = input.sort ?? 'plays';
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);

    const rows = await this.facebookReelsRepository
      .createQueryBuilder('reel')
      .where('reel.assetId = :assetId', { assetId: asset.id })
      .andWhere('reel.tenantId = :tenantId', { tenantId: input.tenantId })
      .andWhere('reel.workspaceId = :workspaceId', {
        workspaceId: input.workspaceId,
      })
      .andWhere(
        input.agencyClientId === null
          ? 'reel.agencyClientId IS NULL'
          : 'reel.agencyClientId = :agencyClientId',
        input.agencyClientId === null
          ? {}
          : { agencyClientId: input.agencyClientId },
      )
      .andWhere('reel.publishedAt IS NOT NULL')
      .andWhere('reel.publishedAt >= :since', {
        since: `${period.since}T00:00:00Z`,
      })
      .andWhere('reel.publishedAt < :until', {
        until: `${shiftCalendarDay(period.until, 1)}T00:00:00Z`,
      })
      .getMany();

    const items = rows.map(toSocialOrganicFacebookReelView);

    items.sort((a, b) => compareFacebookReels(a, b, sort));

    return { items: items.slice(0, limit), total: items.length };
  }

  private parsePeriod(input: { since: string; until: string }) {
    try {
      return parseOrganicAnalyticsPeriod(input);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid analytics period.',
      );
    }
  }

  /**
   * Scope resolution and existence check are the same query, mirroring
   * `SocialAnalyticsReadService.findInScope` exactly: an asset in another
   * tenant, workspace or managed client is "not found" — the same answer as
   * an id that never existed. `ForbiddenException` would confirm the id is
   * real and make this endpoint an enumeration oracle.
   */
  private async findAssetInScope(
    input: SocialOrganicAnalyticsScope & { assetId: string },
  ): Promise<SocialOrganicAssetEntity> {
    const asset = await this.assetsRepository.findOne({
      where: {
        id: input.assetId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        // `IsNull()`, not `null` — a literal null reads as "no filter" and
        // would silently widen the lookup to every managed client's assets.
        agencyClientId: input.agencyClientId ?? IsNull(),
        companyContextId: input.companyContextId ?? IsNull(),
      },
      select: ['id', 'tenantId', 'workspaceId', 'assetTimezone'],
    });

    if (!asset) {
      throw new NotFoundException('Asset not found.');
    }

    return asset;
  }

  /**
   * One period's additive totals, summed in Postgres — `SUM` over `bigint`
   * stays exact and comes back as text, so no value in this path is ever a
   * JS number.
   */
  private async aggregate(
    assetId: string,
    since: string,
    until: string,
  ): Promise<AggregateRow> {
    const row = await this.metricsRepository
      .createQueryBuilder('fact')
      .select('SUM(fact.impressions)', 'impressions')
      .addSelect('SUM(fact.reach)', 'reach')
      .addSelect('COUNT(fact.reach)', 'reach_days')
      .addSelect('COUNT(DISTINCT fact.metric_date)', 'fact_days')
      .addSelect(
        'COUNT(DISTINCT fact.metric_date) FILTER (WHERE fact.is_partial)',
        'partial_days',
      )
      .addSelect('SUM(fact.followers_gained)', 'followers_gained')
      .addSelect('SUM(fact.followers_lost)', 'followers_lost')
      .addSelect('SUM(fact.profile_views)', 'profile_views')
      .addSelect('SUM(fact.total_interactions)', 'total_interactions')
      .addSelect('SUM(fact.likes)', 'likes')
      .addSelect('SUM(fact.comments)', 'comments')
      .addSelect('SUM(fact.shares)', 'shares')
      .addSelect('SUM(fact.saves)', 'saves')
      .addSelect('SUM(fact.replies)', 'replies')
      .addSelect('SUM(fact.accounts_engaged)', 'accounts_engaged')
      .addSelect('COUNT(fact.accounts_engaged)', 'accounts_engaged_days')
      .where('fact.asset_id = :assetId', { assetId })
      .andWhere('fact.metric_date BETWEEN :since AND :until', {
        since,
        until,
      })
      .getRawOne<AggregateRow>();

    return row ?? ({} as AggregateRow);
  }

  /**
   * `followersCount` stock rule: the latest observed value inside the
   * period, never summed. Query builder, not raw SQL — `.andWhere` filters
   * out NULL observations and `.orderBy('metricDate', 'DESC').limit(1)`
   * takes the newest one. `null` if no observation exists in the window.
   */
  private async readFollowersCountStock(
    assetId: string,
    since: string,
    until: string,
  ): Promise<string | null> {
    const row = await this.metricsRepository
      .createQueryBuilder('fact')
      .select('fact.followersCount', 'followers_count')
      .where('fact.assetId = :assetId', { assetId })
      .andWhere('fact.metricDate BETWEEN :since AND :until', { since, until })
      .andWhere('fact.followersCount IS NOT NULL')
      .orderBy('fact.metricDate', 'DESC')
      .limit(1)
      .getRawOne<{ followers_count: string | null }>();

    return row?.followers_count ?? null;
  }

  private async readMetricsFreshness(
    assetId: string,
  ): Promise<SocialOrganicAnalyticsFreshnessView['metrics']> {
    const row = await this.metricsRepository
      .createQueryBuilder('fact')
      .select(`to_char(MAX(fact.metric_date), 'YYYY-MM-DD')`, 'latest')
      .addSelect(
        `to_char(MAX(fact.metric_date) FILTER (WHERE NOT fact.is_partial), 'YYYY-MM-DD')`,
        'latest_closed',
      )
      .addSelect(
        `to_char(MAX(fact.metric_date) FILTER (WHERE fact.is_partial), 'YYYY-MM-DD')`,
        'latest_partial',
      )
      .addSelect('MAX(fact.synced_at)', 'latest_synced_at')
      .where('fact.asset_id = :assetId', { assetId })
      .getRawOne<{
        latest: string | null;
        latest_closed: string | null;
        latest_partial: string | null;
        latest_synced_at: Date | string | null;
      }>();

    return {
      latestMetricDate: row?.latest ?? null,
      latestClosedMetricDate: row?.latest_closed ?? null,
      latestPartialMetricDate: row?.latest_partial ?? null,
      latestMetricsSyncedAt: readInstant(row?.latest_synced_at ?? null),
    };
  }

  private async findLatestSuccessfulRun(
    assetId: string,
    runKind: string,
  ): Promise<string | null> {
    const row = await this.runsRepository
      .createQueryBuilder('run')
      .select('MAX(run.finishedAt)', 'finished_at')
      .where('run.assetId = :assetId', { assetId })
      .andWhere('run.runKind = :runKind', { runKind })
      .andWhere(`run.status = 'succeeded'`)
      .getRawOne<{ finished_at: Date | string | null }>();

    return readInstant(row?.finished_at ?? null);
  }

  /**
   * The newest day this asset has any fact for, unbounded by the requested
   * period — it answers "how current is the read model?", which a
   * period-bounded version could only ever answer with the period's own end.
   */
  private async findLastFactDate(assetId: string): Promise<string | null> {
    const row = await this.metricsRepository
      .createQueryBuilder('fact')
      .select(`to_char(MAX(fact.metric_date), 'YYYY-MM-DD')`, 'last')
      .where('fact.asset_id = :assetId', { assetId })
      .getRawOne<{ last: string | null }>();

    return row?.last ?? null;
  }

  /**
   * The cached period measurement for this exact window, or null.
   *
   * Exact-match only, never the nearest window: a measurement of 1–30 September
   * says nothing about 5–12 September, and offering it would answer a question
   * the operator did not ask with a number they would have no way to question.
   */
  private async findPeriodReach(
    assetId: string,
    since: string,
    until: string,
  ): Promise<SocialOrganicReachPeriodEntity | null> {
    return this.reachPeriodsRepository.findOne({
      where: { assetId, periodSince: since, periodUntil: until },
      select: [
        'reach',
        'reachOrganic',
        'reachPaid',
        'reachFeed',
        'reachReel',
        'reachStory',
        'views',
        'viewsOrganic',
        'viewsPaid',
        'viewsFeed',
        'viewsReel',
        'viewsStory',
        'interactionsReel',
        'interactionsStory',
        'likesReel',
        'commentsReel',
        'savesReel',
        'sharesReel',
        'sharesStory',
        'measuredSince',
        'measuredUntil',
        'truncated',
      ],
    });
  }

  private toTotals(
    row: AggregateRow,
    followersCount: string | null,
    measurement: SocialOrganicReachPeriodEntity | null,
    counts: PublicationCounts,
  ): SocialOrganicAnalyticsTotals {
    const periodReach = measurement?.reach ?? null;

    return {
      impressions: toCount(row.impressions).toString(),
      reach: readReach(row),
      reachGranularity: 'daily',
      followersCount,
      followersGained: toCount(row.followers_gained).toString(),
      followersLost: toCount(row.followers_lost).toString(),
      profileViews: toCount(row.profile_views).toString(),
      totalInteractions: toCount(row.total_interactions).toString(),
      likes: toCount(row.likes).toString(),
      comments: toCount(row.comments).toString(),
      shares: toCount(row.shares).toString(),
      saves: toCount(row.saves).toString(),
      replies: toCount(row.replies).toString(),
      // Only when the period is a single day, for the reason `readReach`
      // returns null on multi-day windows: a per-day distinct count has no
      // additive period equivalent, and the alternative to null is a number
      // that overstates the audience by roughly the number of days.
      accountsEngaged: readSingleDayDistinct(row),
      periodReach,
      // Always true when there is a figure: the request that produces it must
      // omit the breakdown, and the breakdown is what excludes the AD bucket.
      periodReachIncludesAds: periodReach !== null,
      // Passed through exactly as measured. No arithmetic between them here or
      // anywhere downstream: the slices overlap the total, so every apparently
      // obvious subtraction produces a number Meta never reported.
      periodReachOrganic: measurement?.reachOrganic ?? null,
      periodReachPaid: measurement?.reachPaid ?? null,
      periodFeedReach: measurement?.reachFeed ?? null,
      periodReelReach: measurement?.reachReel ?? null,
      periodStoryReach: measurement?.reachStory ?? null,
      periodFeedViews: measurement?.viewsFeed ?? null,
      periodReelViews: measurement?.viewsReel ?? null,
      periodStoryViews: measurement?.viewsStory ?? null,
      periodReelInteractions: measurement?.interactionsReel ?? null,
      periodStoryInteractions: measurement?.interactionsStory ?? null,
      periodReelLikes: measurement?.likesReel ?? null,
      periodReelComments: measurement?.commentsReel ?? null,
      periodReelSaves: measurement?.savesReel ?? null,
      periodReelShares: measurement?.sharesReel ?? null,
      periodStoryShares: measurement?.sharesStory ?? null,
      // Counted, not measured — and so a real zero rather than a null when the
      // account simply published nothing.
      publications: counts.publications,
      periodReelCount: counts.reels,
      periodStoryCount: counts.stories,
      // The Facebook figures. `pageViews` is measured by Meta for the window;
      // the rest are summed from the post facts, which is why they are counts
      // rather than nullable measurements — an account with no posts really did
      // get zero reactions, and there is no provider to have stayed silent.
      pageViews: measurement?.pageViews ?? null,
      pageReactions: counts.pageReactions,
      pageComments: counts.pageComments,
      pageShares: counts.pageShares,
      pagePostCount: counts.pagePosts,
      pageReelCount: counts.pageReels,
      pageReelPlays: counts.pageReelPlays,
      pageReelViewers: counts.pageReelViewers,
      pageReelWatchTimeSeconds: counts.pageReelWatchTimeSeconds,
      pageReelReactions: counts.pageReelReactions,
      pageReelComments: counts.pageReelComments,
      pageReelShares: counts.pageReelShares,
      periodViews: measurement?.views ?? null,
      periodViewsOrganic: measurement?.viewsOrganic ?? null,
      periodViewsPaid: measurement?.viewsPaid ?? null,
      periodMeasuredSince: measurement?.measuredSince ?? null,
      periodMeasuredUntil: measurement?.measuredUntil ?? null,
      periodTruncated: measurement?.truncated ?? false,
    };
  }
}

/**
 * A per-day distinct count, or null when the period spans more than one
 * reporting day.
 *
 * Deliberately shaped like `readReach`: both answer "how many different
 * people", both are measured within a day, and neither can be recovered for a
 * longer window by addition. A caller wanting a period figure needs Meta to
 * measure the period, which this metric does not offer.
 */
function readSingleDayDistinct(row: AggregateRow): string | null {
  const days = toCount(row.accounts_engaged_days);

  return days === 1n ? toCount(row.accounts_engaged).toString() : null;
}

/** A timestamp column, whatever shape the driver returned it in. */
function readInstant(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;

  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

/**
 * Reach, or null — never a sum. Only returned when the period is exactly one
 * day and that day reported it; see paid's `readReach` for the full
 * rationale, reimplemented here rather than imported.
 */
function readReach(row: AggregateRow): string | null {
  const days = toCount(row.fact_days);
  const reachDays = toCount(row.reach_days);

  if (days === 0n || days !== 1n) return null;
  if (reachDays !== days) return null;

  return row.reach === null || row.reach === undefined
    ? null
    : toCount(row.reach).toString();
}

/**
 * A `SUM(bigint)` result that keeps NULL as null instead of reading it as zero.
 *
 * The opposite of `toCount`, and deliberately a separate function rather than a
 * flag on it. `toCount`'s NULL-is-zero rule is right for a column that has
 * always existed: a missing sum there means no rows matched. It is wrong for
 * the engagement columns, which were added on 2026-09-23 with no backfill for
 * days whose `provider_metrics` never carried them — there, NULL means "not
 * collected", and a chart has to break the line rather than draw a zero.
 */
function readNullableCount(value: string | null | undefined): string | null {
  return value === null || value === undefined
    ? null
    : toCount(value).toString();
}

/** A `SUM(bigint)` result as an exact integer, with NULL meaning zero. */
function toCount(value: string | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;

  const text = String(value).split('.')[0];

  return text.length && /^-?\d+$/.test(text) ? BigInt(text) : 0n;
}

/**
 * Orders two ranked posts by one lifetime counter, descending.
 *
 * Null sorts last, always, and never as zero: a counter Meta did not report is
 * not a post that scored nothing, and letting it sink to the bottom is the only
 * ordering that does not claim otherwise. `publishedAt` is the one non-numeric
 * key, ordered newest first.
 *
 * Ties break on the provider id so the order is stable between requests —
 * without it, two posts with the same reach could swap places on a refresh and
 * look like the data moved.
 */
function compareTopPosts(
  a: SocialOrganicTopPostView,
  b: SocialOrganicTopPostView,
  sort: SocialOrganicTopPostSort,
): number {
  if (sort === 'publishedAt') {
    const left = a.publishedAt ?? '';
    const right = b.publishedAt ?? '';
    if (left !== right) return left < right ? 1 : -1;
    return a.externalPublicationId.localeCompare(b.externalPublicationId);
  }

  const left = a[sort];
  const right = b[sort];

  if (left === null && right === null) {
    return a.externalPublicationId.localeCompare(b.externalPublicationId);
  }
  if (left === null) return 1;
  if (right === null) return -1;

  // BigInt rather than Number: these are `bigint` columns and a lifetime view
  // count can exceed 2^53 on a large account.
  const diff = BigInt(left) - BigInt(right);
  if (diff !== 0n) return diff > 0n ? -1 : 1;

  return a.externalPublicationId.localeCompare(b.externalPublicationId);
}

/**
 * Orders a reel ranking, descending, with a stable tiebreak.
 *
 * Its own comparator rather than a shared generic: the sort keys are a
 * different set, and a shared one would have to accept any string, losing the
 * check that the key names a column that exists on this shape.
 */
function compareFacebookReels(
  a: SocialOrganicFacebookReelView,
  b: SocialOrganicFacebookReelView,
  sort: SocialOrganicFacebookReelSort,
): number {
  if (sort === 'publishedAt') {
    const left = a.publishedAt ?? '';
    const right = b.publishedAt ?? '';
    if (left !== right) return left < right ? 1 : -1;
    return a.externalPublicationId.localeCompare(b.externalPublicationId);
  }

  const left = a[sort];
  const right = b[sort];

  // Nulls last in both directions: a reel Meta did not measure should not head
  // a ranking, and should not be dropped from it either.
  if (left === null && right === null) {
    return a.externalPublicationId.localeCompare(b.externalPublicationId);
  }
  if (left === null) return 1;
  if (right === null) return -1;

  // BigInt rather than Number: watch time is milliseconds summed over every
  // viewer, which passes 2^53 on a reel that does well.
  const diff = BigInt(left) - BigInt(right);
  if (diff !== 0n) return diff > 0n ? -1 : 1;

  return a.externalPublicationId.localeCompare(b.externalPublicationId);
}

function toSocialOrganicTopStoryView(
  story: SocialOrganicStoryEntity,
): SocialOrganicTopStoryView {
  return {
    externalPublicationId: story.externalPublicationId,
    assetId: story.assetId,
    publishedAt: story.publishedAt?.toISOString() ?? null,
    mediaType: story.mediaType,
    permalink: story.permalink,
    // Serialised as stored. It may already have expired — see the view's
    // docblock — and the reader renders the absence rather than the service
    // pretending to know whether it still resolves.
    mediaUrl: story.mediaUrl,
    thumbnailUrl: story.thumbnailUrl,
    views: story.views,
    reach: story.reach,
    totalInteractions: story.totalInteractions,
    profileVisits: story.profileVisits,
    replies: story.replies,
    shares: story.shares,
    navForward: story.navForward,
    navNextStory: story.navNextStory,
    navBack: story.navBack,
    navExit: story.navExit,
    observedAt: story.observedAt?.toISOString() ?? null,
  };
}

/** Same ordering rules as `compareTopPosts`: nulls last, ties by id. */
function compareTopStories(
  a: SocialOrganicTopStoryView,
  b: SocialOrganicTopStoryView,
  sort: SocialOrganicTopStorySort,
): number {
  if (sort === 'publishedAt') {
    const left = a.publishedAt ?? '';
    const right = b.publishedAt ?? '';
    if (left !== right) return left < right ? 1 : -1;
    return a.externalPublicationId.localeCompare(b.externalPublicationId);
  }

  const left = a[sort];
  const right = b[sort];

  if (left === null && right === null) {
    return a.externalPublicationId.localeCompare(b.externalPublicationId);
  }
  if (left === null) return 1;
  if (right === null) return -1;

  const diff = BigInt(left) - BigInt(right);
  if (diff !== 0n) return diff > 0n ? -1 : 1;

  return a.externalPublicationId.localeCompare(b.externalPublicationId);
}
