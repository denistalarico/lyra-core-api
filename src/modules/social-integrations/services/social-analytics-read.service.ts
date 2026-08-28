import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import {
  SocialAdKpiInputs,
  deriveChange,
  deriveSocialAdKpis,
} from '../analytics/social-ad-kpi';
import {
  SocialAdAnalyticsPeriod,
  parseAnalyticsPeriod,
  previousAnalyticsPeriod,
} from '../analytics/social-ad-analytics-period';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import { SocialAdEntity } from '../entities/social-ad-entity.entity';
import { SocialAdMetricDailyEntity } from '../entities/social-ad-metric-daily.entity';
import { SocialAdSyncRunEntity } from '../entities/social-ad-sync-run.entity';
import { shiftDay } from '../sync/insights-window';
import { parseScaledAmount } from '../sync/metric-number';
import { planBackfillChunks } from '../sync/social-ad-backfill-plan';
import type {
  SocialAdAnalyticsChange,
  SocialAdAnalyticsOverviewView,
  SocialAdAnalyticsTotals,
} from '../views/social-ad-analytics-overview.view';
import {
  toSocialAdAnalyticsConnectionView,
  type SocialAdAnalyticsConnectionView,
} from '../views/social-ad-analytics-connection.view';
import type {
  SocialAdAnalyticsCampaignsView,
  SocialAdCampaignRow,
  SocialAdCampaignSort,
  SocialAdSortDirection,
} from '../views/social-ad-analytics-campaigns.view';
import {
  toBackfillChainStatus,
  type SocialAdAnalyticsFreshnessView,
} from '../views/social-ad-analytics-freshness.view';
import type {
  SocialAdAnalyticsSeriesView,
  SocialAdSeriesPoint,
} from '../views/social-ad-analytics-series.view';
import {
  groupOutcomesByWindow,
  resolveChunkState,
} from './social-ad-backfill-planner.service';
import { SocialAdSyncConfigService } from './social-ad-sync-config.service';
import type { SocialAdBackfillChunkOutcome } from './social-ad-sync-run.service';

/**
 * The level the overview aggregates.
 *
 * S2.4 ingests insights at two levels — `account` and `campaign` — and both
 * describe the same money. Summing across them without a filter double-counts
 * every metric on the page, which is the single most likely way this endpoint
 * could report a wrong total.
 *
 * `account` rather than a sum of campaigns, because they are not equal: Meta's
 * account-level row includes delivery that belongs to no campaign the hierarchy
 * mirrored yet, and it is the figure Ads Manager shows as the account total. A
 * dashboard whose header does not reconcile with Ads Manager is a dashboard
 * nobody trusts.
 */
const OVERVIEW_ENTITY_LEVEL = 'account';

/** Facts written by paid delivery. The only source S2 ingests. */
const OVERVIEW_SOURCE = 'paid';

/**
 * The attribution configuration every analytics read reports under.
 *
 * Pinned rather than summed. The fact table's unique key admits several rows per
 * object per day, one per attribution setting, precisely so that a future 7-day
 * or 1-day-click pull lands beside the account-default row instead of
 * overwriting it. The day that happens, an aggregate without this filter would
 * add two measurements of the same delivery together and double the account's
 * spend — a failure that would appear silently, months from now, in a slice of
 * this code nobody was editing.
 */
const ANALYTICS_ATTRIBUTION = 'account_default';

/** Campaign facts, for the per-campaign breakdown. */
const CAMPAIGN_ENTITY_LEVEL = 'campaign';

export type SocialAdAnalyticsScope = {
  tenantId: string;
  workspaceId: string;
  /** NULL means agency context: the agency's own connections. */
  agencyClientId: string | null;
};

export type SocialAdAnalyticsOverviewInput = SocialAdAnalyticsScope & {
  connectionId: string;
  since: unknown;
  until: unknown;
};

export type SocialAdAnalyticsCampaignsInput = SocialAdAnalyticsOverviewInput & {
  sort?: SocialAdCampaignSort;
  direction?: SocialAdSortDirection;
};

export type SocialAdAnalyticsFreshnessInput = SocialAdAnalyticsScope & {
  connectionId: string;
};

/** The raw shape one aggregation query returns, all columns as text. */
type AggregateRow = {
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  link_clicks: string | null;
  leads: string | null;
  conversions: string | null;
  conversion_value: string | null;
  video_views: string | null;
  reach: string | null;
  reach_days: string | null;
  fact_days: string | null;
  partial_days: string | null;
  currency: string | null;
};

/**
 * Every read the Social Analytics dashboard makes.
 *
 * The rule that defines this service: **it never speaks to a provider.** Not to
 * refresh, not to fill a gap, not to check whether a number changed. Everything
 * it returns comes from `social_ad_metrics_daily` and the connection row, and if
 * the read model is behind then the honest answer is a stale number plus
 * `lastFactDate` saying how stale — not an inline Graph call that turns a
 * dashboard load into a rate-limited, latency-unbounded provider request that
 * fails whenever a token expires.
 *
 * Deliberately not built on `SocialAdCredentialResolver`, which is the scope
 * boundary everywhere else in this module. The resolver decrypts a token and
 * refuses on `token_expired`, `credential_removed` and `connection_not_connected`
 * — all correct for a sync, all wrong here. A disconnected account's ninety days
 * of stored history are still true, still the client's, and still what somebody
 * needs to read while they sort the credential out. Scope is enforced by making
 * it part of the lookup instead, which is the same guarantee without the token.
 */
@Injectable()
export class SocialAnalyticsReadService {
  constructor(
    @InjectRepository(SocialAdAccountConnectionEntity, 'agency')
    private readonly connectionsRepository: Repository<SocialAdAccountConnectionEntity>,
    @InjectRepository(SocialAdMetricDailyEntity, 'agency')
    private readonly metricsRepository: Repository<SocialAdMetricDailyEntity>,
    @InjectRepository(SocialAdEntity, 'agency')
    private readonly entitiesRepository: Repository<SocialAdEntity>,
    @InjectRepository(SocialAdSyncRunEntity, 'agency')
    private readonly runsRepository: Repository<SocialAdSyncRunEntity>,
    /**
     * Config only — chunk size and horizon, so the chain is measured against the
     * same plan the planner builds.
     *
     * Notably *not* `SocialAdSyncRunService`, even though it owns
     * `listBackfillChunkOutcomes` and reusing it would have been the obvious
     * move: that service holds `SocialAdCredentialResolver`, and injecting it
     * would put a token-capable dependency on the read path. The chunk log is
     * re-queried here — the same three filters and the same deterministic order
     * — rather than reached through a class that can decrypt a credential.
     */
    private readonly config: SocialAdSyncConfigService,
  ) {}

  /**
   * The ad accounts this caller may report on, for the dashboard's picker.
   *
   * Exists because the settings screen's `GET /social/integrations/connections`
   * is guarded by `social.settings.integrations.manage.admin`. A manager holding
   * only the operational analytics permission would be refused by it and land on
   * a dashboard with nothing to select — so the choice was to weaken that guard
   * or to add this. Weakening it would have made every analytics reader able to
   * see the credential surface, which is the wrong trade: this returns strictly
   * less, under the permission that already governs reading these numbers.
   *
   * Every connection in scope is returned, including disconnected ones, for the
   * same reason the rest of this service reads them — their stored history is
   * still real, and a picker that hid them would make that history unreachable.
   * `connectionStatus` travels so the UI can say the account is no longer being
   * updated instead of implying the numbers are current.
   */
  async listConnections(
    input: SocialAdAnalyticsScope,
  ): Promise<SocialAdAnalyticsConnectionView[]> {
    const connections = await this.connectionsRepository.find({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        // `IsNull()`, not `null` — see `findInScope`. A literal null here reads
        // as "no filter" and would list every managed client's ad accounts.
        agencyClientId: input.agencyClientId ?? IsNull(),
        // Only rows that reached an ad account.
        //
        // A connection abandoned mid-OAuth — the operator closed the Meta
        // window, or the exchange failed — is stored with no
        // `external_account_id` and never acquires one. It cannot have a single
        // fact, so offering it in a picker gives the reader an unnamed option
        // that reports zeros forever. This is a reporting surface, and the only
        // accounts worth listing are the ones that can be reported on; the
        // settings screen still shows every row, because resolving that failed
        // attempt is its job.
        externalAccountId: Not(IsNull()),
      },
      // Named columns rather than the whole row: the entity carries
      // `access_token_encrypted` and `oauth_state_hash`, and neither should be
      // loaded into a process that is about to serialize a response.
      select: [
        'id',
        'provider',
        'connectionStatus',
        'accountName',
        'externalAccountId',
        'currency',
        'timezone',
        'lastSyncedAt',
      ],
      // Named accounts first, then oldest — a stable order, so the auto-select
      // of a single account and the default of a list do not depend on
      // Postgres's physical row order.
      order: { accountName: 'ASC', createdAt: 'ASC' },
    });

    return connections.map(toSocialAdAnalyticsConnectionView);
  }

  /**
   * Totals, KPIs and period-over-period movement for one connection.
   *
   * Three queries and no provider call: the connection (which also enforces
   * scope), the current period's aggregate, and the previous period's. The
   * comparison window is derived, never accepted from the caller — a client that
   * could name both sides could compare a month against a day and present the
   * difference as growth.
   */
  async overview(
    input: SocialAdAnalyticsOverviewInput,
  ): Promise<SocialAdAnalyticsOverviewView> {
    const period = parseAnalyticsPeriod({
      since: input.since,
      until: input.until,
    });
    const comparison = previousAnalyticsPeriod(period);

    const connection = await this.findInScope(input);

    const [current, previous, lastFactDate] = await Promise.all([
      this.aggregate(connection.id, period),
      this.aggregate(connection.id, comparison),
      this.findLastFactDate(connection.id),
    ]);

    return {
      connectionId: connection.id,
      // From the connection rather than from a fact row: the account's zone is
      // what defined every stored `metric_date`, and it is the only zone in
      // which the requested period means what the caller intended.
      timezone: connection.timezone ?? '',
      currency: current.currency ?? connection.currency ?? null,
      period: { since: period.since, until: period.until },
      comparisonPeriod: { since: comparison.since, until: comparison.until },
      current: this.toTotals(current),
      previous: this.toTotals(previous),
      change: this.toChange(current, previous),
      hasPartialData: toCount(current.partial_days) > 0n,
      lastFactDate,
    };
  }

  /**
   * One point per calendar day, ascending, with KPIs derived per day.
   *
   * The series is *continuous*: every day between `since` and `until` appears
   * exactly once, and a day the read model never observed carries
   * `hasData: false` with nulls rather than zeros. Returning only observed days
   * would leave a chart unable to tell "spent nothing" from "never synced" — it
   * would draw a straight line across both — and emitting zeros would state the
   * stronger of those two as fact.
   *
   * The days are generated here rather than by `generate_series` so the calendar
   * arithmetic stays in the one module that already owns it, and so the gap
   * logic is exercised by the same unit tests as everything else.
   */
  async timeseries(
    input: SocialAdAnalyticsOverviewInput,
  ): Promise<SocialAdAnalyticsSeriesView> {
    const period = parseAnalyticsPeriod({
      since: input.since,
      until: input.until,
    });

    const connection = await this.findInScope(input);

    const rows = await this.metricsRepository
      .createQueryBuilder('fact')
      .select(`to_char(fact.metric_date, 'YYYY-MM-DD')`, 'metric_date')
      .addSelect('SUM(fact.spend)', 'spend')
      .addSelect('SUM(fact.impressions)', 'impressions')
      .addSelect('SUM(fact.clicks)', 'clicks')
      .addSelect('SUM(fact.link_clicks)', 'link_clicks')
      .addSelect('SUM(fact.leads)', 'leads')
      .addSelect('SUM(fact.conversions)', 'conversions')
      .addSelect('SUM(fact.conversion_value)', 'conversion_value')
      .addSelect('SUM(fact.video_views)', 'video_views')
      // Grouped by day, so this sum is over one day's rows only — the grain
      // reach was measured at. This is the one query in the module where
      // returning it is honest.
      .addSelect('SUM(fact.reach)', 'reach')
      .addSelect('COUNT(fact.reach)', 'reach_days')
      .addSelect('COUNT(DISTINCT fact.metric_date)', 'fact_days')
      .addSelect('bool_or(fact.is_partial)', 'is_partial')
      .addSelect('MAX(fact.currency)', 'currency')
      .where('fact.connection_id = :connectionId', {
        connectionId: connection.id,
      })
      .andWhere('fact.entity_level = :level', { level: OVERVIEW_ENTITY_LEVEL })
      .andWhere('fact.source = :source', { source: OVERVIEW_SOURCE })
      .andWhere('fact.attribution_setting = :attribution', {
        attribution: ANALYTICS_ATTRIBUTION,
      })
      .andWhere('fact.metric_date BETWEEN :since AND :until', {
        since: period.since,
        until: period.until,
      })
      .groupBy('fact.metric_date')
      .orderBy('fact.metric_date', 'ASC')
      .getRawMany<
        AggregateRow & { metric_date: string; is_partial: boolean }
      >();

    const byDate = new Map(rows.map((row) => [row.metric_date, row]));

    const points: SocialAdSeriesPoint[] = [];
    let currency: string | null = null;

    for (let day = period.since; day <= period.until; day = shiftDay(day, 1)) {
      const row = byDate.get(day);

      if (!row) {
        points.push(emptySeriesPoint(day));
        continue;
      }

      currency ??= row.currency ?? null;
      points.push(toSeriesPoint(day, row));
    }

    return {
      connectionId: connection.id,
      timezone: connection.timezone ?? '',
      currency: currency ?? connection.currency ?? null,
      period: { since: period.since, until: period.until },
      seriesMode: 'continuous',
      points,
      observedDays: rows.length,
      hasPartialData: rows.some((row) => row.is_partial),
    };
  }

  /**
   * Per-campaign totals for the period, ranked.
   *
   * Two steps rather than one join: the facts are aggregated by
   * `campaign_external_id` first, and the hierarchy is looked up separately and
   * merged in memory. A single join would be tidier to write and worse in two
   * ways — a campaign whose row has not been mirrored yet would vanish from an
   * inner join (taking its spend with it) and the identity condition would have
   * to be repeated on every branch of the query, which is the condition that
   * must not be got wrong.
   *
   * Only campaigns with at least one fact in the period appear. This is a
   * ranking of what ran; padding it with every campaign that ever existed would
   * bury the answer under paused history.
   */
  async campaigns(
    input: SocialAdAnalyticsCampaignsInput,
  ): Promise<SocialAdAnalyticsCampaignsView> {
    const period = parseAnalyticsPeriod({
      since: input.since,
      until: input.until,
    });
    const sort = input.sort ?? 'spend';
    const direction = input.direction ?? 'desc';

    const connection = await this.findInScope(input);

    const rows = await this.metricsRepository
      .createQueryBuilder('fact')
      .select('fact.campaign_external_id', 'campaign_external_id')
      .addSelect('SUM(fact.spend)', 'spend')
      .addSelect('SUM(fact.impressions)', 'impressions')
      .addSelect('SUM(fact.clicks)', 'clicks')
      .addSelect('SUM(fact.link_clicks)', 'link_clicks')
      .addSelect('SUM(fact.leads)', 'leads')
      .addSelect('SUM(fact.conversions)', 'conversions')
      .addSelect('SUM(fact.conversion_value)', 'conversion_value')
      .addSelect('SUM(fact.video_views)', 'video_views')
      .addSelect('SUM(fact.reach)', 'reach')
      .addSelect('COUNT(fact.reach)', 'reach_days')
      .addSelect('COUNT(DISTINCT fact.metric_date)', 'fact_days')
      .addSelect(
        'COUNT(DISTINCT fact.metric_date) FILTER (WHERE fact.is_partial)',
        'partial_days',
      )
      .addSelect('MAX(fact.currency)', 'currency')
      .where('fact.connection_id = :connectionId', {
        connectionId: connection.id,
      })
      .andWhere('fact.entity_level = :level', { level: CAMPAIGN_ENTITY_LEVEL })
      .andWhere('fact.source = :source', { source: OVERVIEW_SOURCE })
      .andWhere('fact.attribution_setting = :attribution', {
        attribution: ANALYTICS_ATTRIBUTION,
      })
      .andWhere('fact.campaign_external_id IS NOT NULL')
      .andWhere('fact.metric_date BETWEEN :since AND :until', {
        since: period.since,
        until: period.until,
      })
      .groupBy('fact.campaign_external_id')
      // The sort is a lookup into a closed map, never the caller's string. See
      // `CAMPAIGN_SORT_SQL`.
      .orderBy(
        CAMPAIGN_SORT_SQL[sort],
        direction === 'asc' ? 'ASC' : 'DESC',
        'NULLS LAST',
      )
      // A stable tiebreak, so two campaigns with identical spend do not swap
      // places between requests and make a table appear to flicker.
      .addOrderBy('fact.campaign_external_id', 'ASC')
      .getRawMany<AggregateRow & { campaign_external_id: string }>();

    const identities = await this.findCampaignIdentities(
      connection,
      rows.map((row) => row.campaign_external_id),
    );

    return {
      connectionId: connection.id,
      timezone: connection.timezone ?? '',
      currency: rows[0]?.currency ?? connection.currency ?? null,
      period: { since: period.since, until: period.until },
      sort,
      direction,
      items: rows.map((row) =>
        this.toCampaignRow(row, identities.get(row.campaign_external_id)),
      ),
      total: rows.length,
    };
  }

  /**
   * How current this connection's read model is, and where its backfill stands.
   *
   * Pure: it derives the chain's state from the run log using the very functions
   * the planner uses, and enqueues nothing. Calling `planNext` here would have
   * been shorter and would have made loading a dashboard queue provider work —
   * a read endpoint with a side effect that costs quota.
   */
  async freshness(
    input: SocialAdAnalyticsFreshnessInput,
  ): Promise<SocialAdAnalyticsFreshnessView> {
    const connection = await this.findInScope(input, [
      'id',
      'timezone',
      'currency',
      'connectionStatus',
      'lastSyncedAt',
      'lastSyncError',
    ]);

    const [metrics, outcomes, dailyRun, intradayRun] = await Promise.all([
      this.readMetricsFreshness(connection.id),
      this.listBackfillChunkOutcomes(connection.id),
      this.findLatestSuccessfulRun(connection.id, 'daily'),
      this.findLatestSuccessfulRun(connection.id, 'intraday'),
    ]);

    return {
      connectionId: connection.id,
      timezone: connection.timezone ?? '',
      connectionStatus: connection.connectionStatus,
      lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
      lastSyncError: connection.lastSyncError ?? null,
      metrics,
      runs: {
        latestSuccessfulDailyRun: dailyRun,
        latestSuccessfulIntradayRun: intradayRun,
      },
      backfill: this.describeBackfill(outcomes),
      hasPartialData: metrics.latestPartialMetricDate !== null,
    };
  }

  /**
   * The backfill chain, folded from the same per-chunk states the planner uses.
   *
   * `resolveChunkState` and `planBackfillChunks` are imported rather than
   * reimplemented, and the anchor is read from the run log exactly as the
   * planner reads it — newest `window_end` among this connection's own backfill
   * runs, never recomputed from today. A chain begun fifteen days ago reports
   * the anchor it started with, which is the only figure comparable with the
   * chunk boundaries the queue is working through.
   */
  private describeBackfill(
    outcomes: readonly SocialAdBackfillChunkOutcome[],
  ): SocialAdAnalyticsFreshnessView['backfill'] {
    const anchor = outcomes[0]?.until ?? null;
    const totalDays = this.config.backfillDays;

    if (!anchor || totalDays <= 0) {
      return {
        status: toBackfillChainStatus({
          hasChain: false,
          firstUncovered: null,
        }),
        anchor,
        chunksTotal: 0,
        chunksSucceeded: 0,
        chunksInFlight: 0,
        stalled: false,
        complete: false,
      };
    }

    const chunks = planBackfillChunks({
      anchor,
      totalDays,
      chunkDays: this.config.backfillChunkDays,
    });
    const byWindow = groupOutcomesByWindow(outcomes);

    const states = chunks.map((chunk) =>
      resolveChunkState(byWindow.get(chunk.until) ?? []),
    );
    const firstUncovered = states.find((state) => state !== 'covered') ?? null;

    const status = toBackfillChainStatus({ hasChain: true, firstUncovered });

    return {
      status,
      anchor,
      chunksTotal: chunks.length,
      chunksSucceeded: states.filter((state) => state === 'covered').length,
      chunksInFlight: states.filter((state) => state === 'in_flight').length,
      stalled: status === 'stalled',
      complete: status === 'complete',
    };
  }

  private async readMetricsFreshness(
    connectionId: string,
  ): Promise<SocialAdAnalyticsFreshnessView['metrics']> {
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
      .where('fact.connection_id = :connectionId', { connectionId })
      .andWhere('fact.entity_level = :level', { level: OVERVIEW_ENTITY_LEVEL })
      .andWhere('fact.source = :source', { source: OVERVIEW_SOURCE })
      .andWhere('fact.attribution_setting = :attribution', {
        attribution: ANALYTICS_ATTRIBUTION,
      })
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

  /**
   * Every `backfill` run of this connection, newest window first.
   *
   * Deliberately identical to `SocialAdSyncRunService.listBackfillChunkOutcomes`
   * — same filters, same three-part order — because the chain state this feeds
   * must match what the planner computes exactly. The duplication buys the read
   * path its independence from a service that holds a credential resolver; the
   * gated spec asserts both produce the same answer so the two cannot drift
   * silently.
   *
   * `window_end DESC` alone is not a total order: a window can carry several
   * attempts once a stalled chunk is resumed, and tied rows come back in
   * whatever order the plan produces. `created_at, id` make the anchor
   * deterministic.
   */
  private async listBackfillChunkOutcomes(
    connectionId: string,
  ): Promise<SocialAdBackfillChunkOutcome[]> {
    return this.runsRepository
      .createQueryBuilder('run')
      .select(`to_char(run.window_end, 'YYYY-MM-DD')`, 'until')
      .addSelect('run.status', 'status')
      .where('run.connection_id = :connectionId', { connectionId })
      .andWhere(`run.run_kind = 'backfill'`)
      .andWhere('run.window_end IS NOT NULL')
      .orderBy('run.window_end', 'DESC')
      .addOrderBy('run.created_at', 'ASC')
      .addOrderBy('run.id', 'ASC')
      .getRawMany<SocialAdBackfillChunkOutcome>();
  }

  private async findLatestSuccessfulRun(
    connectionId: string,
    runKind: string,
  ): Promise<string | null> {
    const row = await this.runsRepository
      .createQueryBuilder('run')
      .select('MAX(run.finished_at)', 'finished_at')
      .where('run.connection_id = :connectionId', { connectionId })
      .andWhere('run.run_kind = :runKind', { runKind })
      .andWhere(`run.status = 'succeeded'`)
      .getRawOne<{ finished_at: Date | string | null }>();

    return readInstant(row?.finished_at ?? null);
  }

  /**
   * Campaign names and statuses, looked up under the full identity.
   *
   * The `where` is the whole point of this method. `social_ad_entities` is
   * unique on `(tenant, workspace, connection, level, external_id)`, and every
   * one of those five is bound here: Meta's campaign ids are unique per Business
   * rather than globally, so a lookup by `external_id` alone could return
   * another tenant's campaign name for this tenant's spend — a cross-tenant
   * disclosure through a column nobody thinks of as sensitive.
   *
   * Scope comes from the resolved connection row, never from the request.
   */
  private async findCampaignIdentities(
    connection: SocialAdAccountConnectionEntity,
    externalIds: readonly string[],
  ): Promise<Map<string, SocialAdEntity>> {
    if (externalIds.length === 0) return new Map();

    const entities = await this.entitiesRepository
      .createQueryBuilder('entity')
      .where('entity.tenant_id = :tenantId', { tenantId: connection.tenantId })
      .andWhere('entity.workspace_id = :workspaceId', {
        workspaceId: connection.workspaceId,
      })
      .andWhere('entity.connection_id = :connectionId', {
        connectionId: connection.id,
      })
      .andWhere('entity.entity_level = :level', {
        level: CAMPAIGN_ENTITY_LEVEL,
      })
      .andWhere('entity.external_id IN (:...externalIds)', { externalIds })
      .getMany();

    return new Map(entities.map((entity) => [entity.externalId, entity]));
  }

  private toCampaignRow(
    row: AggregateRow & { campaign_external_id: string },
    entity: SocialAdEntity | undefined,
  ): SocialAdCampaignRow {
    return {
      externalId: row.campaign_external_id,
      // Null rather than the id as a stand-in: a name is a claim about what the
      // provider called this campaign, and echoing the id would make an
      // unmirrored campaign look mirrored.
      name: entity?.name ?? null,
      status: entity?.status ?? null,
      effectiveStatus: entity?.effectiveStatus ?? null,
      objective: entity?.objective ?? null,
      archived: entity?.archivedAt != null,
      spend: formatAmountText(row.spend),
      impressions: toCount(row.impressions).toString(),
      clicks: toCount(row.clicks).toString(),
      linkClicks: toCount(row.link_clicks).toString(),
      leads: toCount(row.leads).toString(),
      conversions: formatAmountText(row.conversions),
      conversionValue: formatAmountText(row.conversion_value),
      videoViews: toCount(row.video_views).toString(),
      reach: readReach(row),
      hasPartialData: toCount(row.partial_days) > 0n,
      ...deriveSocialAdKpis(toKpiInputs(row)),
    };
  }

  /**
   * One period's additive totals, summed in Postgres.
   *
   * `SUM` over `numeric` and `bigint` stays exact in the database and comes back
   * as text, so no value in this path is ever a JS number. Doing the arithmetic
   * here instead — loading rows and adding them in JS — would be both slower and
   * wrong, since a year of daily facts summed through doubles drifts in the
   * cents that a client is invoiced for.
   *
   * `COUNT(DISTINCT metric_date)` rather than `COUNT(*)`: a day is one fact at
   * account level today, but the unique key admits several rows per day across
   * `source` and `attribution_setting`, and "how many days do we hold?" must not
   * become "how many measurements do we hold?" the moment a second attribution
   * window is ingested.
   */
  private async aggregate(
    connectionId: string,
    period: SocialAdAnalyticsPeriod,
  ): Promise<AggregateRow> {
    const row = await this.metricsRepository
      .createQueryBuilder('fact')
      .select('SUM(fact.spend)', 'spend')
      .addSelect('SUM(fact.impressions)', 'impressions')
      .addSelect('SUM(fact.clicks)', 'clicks')
      .addSelect('SUM(fact.link_clicks)', 'link_clicks')
      .addSelect('SUM(fact.leads)', 'leads')
      .addSelect('SUM(fact.conversions)', 'conversions')
      .addSelect('SUM(fact.conversion_value)', 'conversion_value')
      .addSelect('SUM(fact.video_views)', 'video_views')
      // Summed only to be discarded unless every day reported it — see
      // `readReach`. Reach is not additive and this total is never returned as
      // one; it exists so the "all days reported" case can answer at all.
      .addSelect('SUM(fact.reach)', 'reach')
      .addSelect('COUNT(fact.reach)', 'reach_days')
      .addSelect('COUNT(DISTINCT fact.metric_date)', 'fact_days')
      .addSelect(
        'COUNT(DISTINCT fact.metric_date) FILTER (WHERE fact.is_partial)',
        'partial_days',
      )
      // MAX over a low-cardinality column: every row of one connection carries
      // the same currency, and MAX avoids a GROUP BY that would split the
      // aggregate if a legacy row disagreed.
      .addSelect('MAX(fact.currency)', 'currency')
      .where('fact.connection_id = :connectionId', { connectionId })
      .andWhere('fact.entity_level = :level', { level: OVERVIEW_ENTITY_LEVEL })
      .andWhere('fact.source = :source', { source: OVERVIEW_SOURCE })
      .andWhere('fact.attribution_setting = :attribution', {
        attribution: ANALYTICS_ATTRIBUTION,
      })
      .andWhere('fact.metric_date BETWEEN :since AND :until', {
        since: period.since,
        until: period.until,
      })
      .getRawOne<AggregateRow>();

    // An aggregate over zero rows still returns one row, of NULLs. Every reader
    // below coerces NULL to zero, so an empty period is a period of zeros rather
    // than a crash — which is the correct answer for an account that had no
    // delivery.
    return row ?? ({} as AggregateRow);
  }

  /**
   * The newest day this connection has any fact for.
   *
   * Unbounded by the requested period on purpose: it answers "how current is the
   * read model?", and a period-bounded version could only ever return the
   * period's own end, which tells nobody anything.
   */
  private async findLastFactDate(connectionId: string): Promise<string | null> {
    const row = await this.metricsRepository
      .createQueryBuilder('fact')
      .select(`to_char(MAX(fact.metric_date), 'YYYY-MM-DD')`, 'last')
      .where('fact.connection_id = :connectionId', { connectionId })
      .andWhere('fact.entity_level = :level', { level: OVERVIEW_ENTITY_LEVEL })
      .andWhere('fact.source = :source', { source: OVERVIEW_SOURCE })
      .andWhere('fact.attribution_setting = :attribution', {
        attribution: ANALYTICS_ATTRIBUTION,
      })
      .getRawOne<{ last: string | null }>();

    return row?.last ?? null;
  }

  private toTotals(row: AggregateRow): SocialAdAnalyticsTotals {
    const inputs = toKpiInputs(row);

    return {
      spend: formatAmountText(row.spend),
      impressions: toCount(row.impressions).toString(),
      clicks: toCount(row.clicks).toString(),
      linkClicks: toCount(row.link_clicks).toString(),
      leads: toCount(row.leads).toString(),
      conversions: formatAmountText(row.conversions),
      conversionValue: formatAmountText(row.conversion_value),
      videoViews: toCount(row.video_views).toString(),
      reach: readReach(row),
      reachGranularity: 'daily',
      ...deriveSocialAdKpis(inputs),
    };
  }

  private toChange(
    current: AggregateRow,
    previous: AggregateRow,
  ): SocialAdAnalyticsChange {
    const now = toKpiInputs(current);
    const before = toKpiInputs(previous);

    return {
      spend: deriveChange(now.spend, before.spend),
      // Counts are scaled up to the shared 1e6 basis so that `absolute` and
      // `percent` carry the same six decimals as every other value in the
      // response, rather than a count changing format depending on the field.
      impressions: deriveChange(
        scaleCount(now.impressions),
        scaleCount(before.impressions),
      ),
      clicks: deriveChange(scaleCount(now.clicks), scaleCount(before.clicks)),
      linkClicks: deriveChange(
        scaleCount(now.linkClicks),
        scaleCount(before.linkClicks),
      ),
      leads: deriveChange(scaleCount(now.leads), scaleCount(before.leads)),
      conversions: deriveChange(now.conversions, before.conversions),
      conversionValue: deriveChange(
        now.conversionValue,
        before.conversionValue,
      ),
      videoViews: deriveChange(
        scaleCount(now.videoViews),
        scaleCount(before.videoViews),
      ),
    };
  }

  /**
   * Scope resolution and existence check are the same query, exactly as
   * `SocialAdConnectionService.findInScope` does it.
   *
   * A connection in another tenant, another workspace or another managed client
   * is "not found" — the same answer as an id that never existed. Answering
   * "forbidden" would confirm the id is real and make the endpoint an
   * enumeration oracle for which clients run ads.
   *
   * Notably absent: any filter on `connection_status`. A disconnected account's
   * history is still readable, because it is still true.
   */
  private async findInScope(
    input: SocialAdAnalyticsScope & { connectionId: string },
    select: (keyof SocialAdAccountConnectionEntity)[] = [
      'id',
      'timezone',
      'currency',
    ],
  ) {
    const connection = await this.connectionsRepository.findOne({
      where: {
        id: input.connectionId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        // `IsNull()` rather than `null`: agency scope must match rows where the
        // column is NULL, and TypeORM reads a literal null as "no filter" —
        // which would silently widen the lookup to every client.
        agencyClientId: input.agencyClientId ?? IsNull(),
      },
      // `tenant_id` and `workspace_id` always travel: the campaign identity
      // lookup binds them, and it must bind the *stored* values rather than what
      // the caller claimed, even though the row was found by them.
      select: [...select, 'tenantId', 'workspaceId'],
    });

    if (!connection) {
      throw new NotFoundException('Connection not found.');
    }

    return connection;
  }
}

/**
 * The only expressions a caller's `sort` can become.
 *
 * A closed map, keyed by the union — so an unknown value cannot index it, and
 * nothing the caller sends is ever concatenated into SQL. The values are
 * expressions rather than column names because four of them are derived: sorting
 * by `cpc` has to divide the summed spend by the summed clicks in the database,
 * or the order would disagree with the `cpc` the response reports.
 *
 * `NULLIF(…, 0)` on every denominator makes a zero-denominator campaign sort as
 * NULL, which the query pins to the end with `NULLS LAST`. Without it Postgres
 * raises a division-by-zero and the whole request fails because one campaign had
 * no clicks.
 */
const CAMPAIGN_SORT_SQL: Record<SocialAdCampaignSort, string> = {
  spend: 'SUM(fact.spend)',
  impressions: 'SUM(fact.impressions)',
  clicks: 'SUM(fact.clicks)',
  leads: 'SUM(fact.leads)',
  conversions: 'SUM(fact.conversions)',
  ctr: 'SUM(fact.clicks)::numeric / NULLIF(SUM(fact.impressions), 0)',
  cpc: 'SUM(fact.spend) / NULLIF(SUM(fact.clicks), 0)',
  cpl: 'SUM(fact.spend) / NULLIF(SUM(fact.leads), 0)',
  roas: 'SUM(fact.conversion_value) / NULLIF(SUM(fact.spend), 0)',
  // The campaign name lives in another table, so it cannot be ordered here.
  // Grouping by the id and sorting by it keeps the query honest; the controller
  // documents that `name` orders by campaign identity, which is stable even
  // when the hierarchy has not been mirrored.
  name: 'fact.campaign_external_id',
};

/** Decimal places of the `numeric(18,6)` fact columns. */
const SCALE_FACTOR = 1_000_000n;

/** A day with no stored fact: nulls throughout, never zeros. */
function emptySeriesPoint(date: string): SocialAdSeriesPoint {
  return {
    date,
    hasData: false,
    spend: null,
    impressions: null,
    clicks: null,
    linkClicks: null,
    leads: null,
    conversions: null,
    conversionValue: null,
    videoViews: null,
    reach: null,
    isPartial: false,
    ctr: null,
    cpc: null,
    cpm: null,
    cpl: null,
    cpa: null,
    roas: null,
  };
}

function toSeriesPoint(
  date: string,
  row: AggregateRow & { is_partial: boolean },
): SocialAdSeriesPoint {
  return {
    date,
    hasData: true,
    spend: formatAmountText(row.spend),
    impressions: toCount(row.impressions).toString(),
    clicks: toCount(row.clicks).toString(),
    linkClicks: toCount(row.link_clicks).toString(),
    leads: toCount(row.leads).toString(),
    conversions: formatAmountText(row.conversions),
    conversionValue: formatAmountText(row.conversion_value),
    videoViews: toCount(row.video_views).toString(),
    // The grain here is one day, which is the grain Meta de-duplicated reach
    // at — so `readReach` returns it rather than refusing.
    reach: readReach(row),
    isPartial: row.is_partial === true,
    ...deriveSocialAdKpis(toKpiInputs(row)),
  };
}

/** A timestamp column, whatever shape the driver returned it in. */
function readInstant(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;

  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toKpiInputs(row: AggregateRow): SocialAdKpiInputs {
  return {
    spend: toAmount(row.spend),
    impressions: toCount(row.impressions),
    clicks: toCount(row.clicks),
    linkClicks: toCount(row.link_clicks),
    leads: toCount(row.leads),
    conversions: toAmount(row.conversions),
    conversionValue: toAmount(row.conversion_value),
    videoViews: toCount(row.video_views),
  };
}

/**
 * Reach, or null — never a sum.
 *
 * Two conditions, and both are about honesty rather than caution. A period where
 * some days reported reach and others did not has no period figure at all: the
 * partial sum would silently describe a subset of the days while being labelled
 * with the whole range. And even when every day reported it, the total is still
 * de-duplicated *per day* — this returns it only for a single-day period, where
 * the daily grain and the period grain are the same thing.
 *
 * Anything wider is `null` plus `reachGranularity`, which is the contract's way
 * of saying the honest answer requires a measurement this system does not have.
 */
function readReach(row: AggregateRow): string | null {
  const days = toCount(row.fact_days);
  const reachDays = toCount(row.reach_days);

  if (days === 0n || days !== 1n) return null;
  if (reachDays !== days) return null;

  const reach = row.reach;

  return reach === null || reach === undefined
    ? null
    : toCount(reach).toString();
}

/** A `SUM(bigint)` result as an exact integer, with NULL meaning zero. */
function toCount(value: string | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;

  // Postgres returns SUM(bigint) as numeric, which can arrive with a trailing
  // `.000` that BigInt() refuses. The fractional part of a sum of integers is
  // always zero, so dropping it loses nothing.
  const text = String(value).split('.')[0];

  return text.length && /^-?\d+$/.test(text) ? BigInt(text) : 0n;
}

/** A `SUM(numeric)` result scaled to 1e6, with NULL meaning zero. */
function toAmount(value: string | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;

  return parseScaledAmount(String(value)) ?? 0n;
}

function scaleCount(count: bigint): bigint {
  return count * SCALE_FACTOR;
}

/** A summed amount as the six-decimal string the API returns. */
function formatAmountText(value: string | null | undefined): string {
  const whole = toAmount(value) / SCALE_FACTOR;
  const fraction = (toAmount(value) % SCALE_FACTOR).toString().padStart(6, '0');

  return `${whole}.${fraction}`;
}
