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
  toSocialOrganicTopPostView,
  type SocialOrganicTopPostSort,
  type SocialOrganicTopPostView,
  type SocialOrganicTopPostsView,
} from './views/social-organic-top-posts.view';
import {
  toSocialOrganicPublicationMetricsView,
  type SocialOrganicPublicationMetricsView,
} from './views/social-organic-publication-metrics.view';

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

    const [aggregate, followersCount, lastFactDate, periodReach] =
      await Promise.all([
        this.aggregate(asset.id, period.since, period.until),
        this.readFollowersCountStock(asset.id, period.since, period.until),
        this.findLastFactDate(asset.id),
        // From the measurement cache, never from the daily rows: no expression
        // over them produces this number, because the duplicates it removes
        // were resolved inside Meta.
        this.findPeriodReach(asset.id, period.since, period.until),
      ]);

    return {
      assetId: asset.id,
      timezone: asset.assetTimezone ?? '',
      period: { since: period.since, until: period.until },
      totals: this.toTotals(aggregate, followersCount, periodReach),
      hasPartialData: toCount(aggregate.partial_days) > 0n,
      lastFactDate,
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
   */
  async topPosts(
    input: SocialOrganicAnalyticsScope & {
      assetId: string;
      since: string;
      until: string;
      sort?: SocialOrganicTopPostSort;
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

    const facts = await latestPerPost.getMany();

    const items = facts.map(toSocialOrganicTopPostView);

    items.sort((a, b) => compareTopPosts(a, b, sort));

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
  ): Promise<string | null> {
    const row = await this.reachPeriodsRepository.findOne({
      where: { assetId, periodSince: since, periodUntil: until },
      select: ['reach'],
    });

    return row?.reach ?? null;
  }

  private toTotals(
    row: AggregateRow,
    followersCount: string | null,
    periodReach: string | null,
  ): SocialOrganicAnalyticsTotals {
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
