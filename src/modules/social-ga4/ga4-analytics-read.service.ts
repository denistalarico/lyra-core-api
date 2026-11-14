import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import type { Ga4Dimension } from './entities';
import {
  Ga4PropertyDirectoryService,
  type Ga4SelectedProperty,
} from './ga4-property-directory.service';
import {
  EMPTY_GA4_SUMS,
  ga4Changes,
  parseGa4Period,
  previousGa4Period,
  toGa4Totals,
  type Ga4Period,
  type Ga4Sums,
} from './ga4-metrics';
import { GA4_OTHER_BUCKET } from './ga4.normalizer';

const DEFAULT_BREAKDOWN_LIMIT = 10;
/** A day without data this long after closing says the sync is behind. */
const STALE_AFTER_HOURS = 36;

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Reads the local GA4 mirror. No method here reaches Google: every number comes
 * from `social_ga4_*`, which the sync fills (D-G5). The property id in the query
 * is only ever resolved against the properties selected for the caller's own
 * scope, so another context's property is a 404, not an empty report.
 */
@Injectable()
export class Ga4AnalyticsReadService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly directory: Ga4PropertyDirectoryService,
  ) {}

  async properties(scope: CompanyAwareScope) {
    const selected = await this.directory.forScope(scope);
    const items: Array<Record<string, unknown>> = [];
    for (const property of selected?.properties ?? []) {
      const [run] = await this.dataSource.query<
        Array<{ status: string; finished_at: Date | null }>
      >(
        `SELECT status, finished_at FROM social_ga4_sync_runs
          WHERE ${this.scopeSql()} AND property_id = $5
          ORDER BY created_at DESC LIMIT 1`,
        this.params(scope, property.propertyId),
      );
      items.push({
        propertyId: property.propertyId,
        displayName: property.displayName,
        accountId: property.accountId,
        timeZone: property.timeZone,
        currency: property.currency,
        lastRunStatus: run?.status ?? null,
        lastRunFinishedAt: run?.finished_at?.toISOString() ?? null,
      });
    }
    return { items, total: items.length };
  }

  async overview(
    scope: CompanyAwareScope,
    query: { propertyId: string; since: string; until: string },
  ) {
    const property = await this.requireProperty(scope, query.propertyId);
    const period = this.period(query.since, query.until);
    const previousPeriod = previousGa4Period(period);
    const [current, previous] = await Promise.all([
      this.sums(scope, property.propertyId, period),
      this.sums(scope, property.propertyId, previousPeriod),
    ]);
    const totals = toGa4Totals(current);
    const previousTotals = toGa4Totals(previous);

    return {
      propertyId: property.propertyId,
      timeZone: property.timeZone,
      currency: property.currency,
      period,
      previousPeriod,
      totals,
      previous: previousTotals,
      changes: ga4Changes(totals, previousTotals),
      // Unique users are not additive across days: over more than one day the
      // figure is Σ daily actives and counts a returning person once per day.
      usersExact: period.days === 1,
    };
  }

  async timeseries(
    scope: CompanyAwareScope,
    query: { propertyId: string; since: string; until: string },
  ) {
    const property = await this.requireProperty(scope, query.propertyId);
    const period = this.period(query.since, query.until);
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT to_char(metric_date, 'YYYY-MM-DD') AS day, sessions, total_users,
              new_users, engaged_sessions, avg_session_seconds, page_views,
              event_count, key_events, total_revenue
         FROM social_ga4_daily_metrics
        WHERE ${this.scopeSql()} AND property_id = $5
          AND metric_date BETWEEN $6::date AND $7::date
        ORDER BY metric_date`,
      [...this.params(scope, property.propertyId), period.since, period.until],
    );
    const byDay = new Map(rows.map((row) => [String(row.day), row]));
    const points: Array<Record<string, unknown>> = [];
    for (let index = 0; index < period.days; index += 1) {
      const day = new Date(
        Date.parse(`${period.since}T00:00:00Z`) + index * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
      const row = byDay.get(day);
      const sums: Ga4Sums = row
        ? {
            sessions: num(row.sessions),
            users: num(row.total_users),
            newUsers: num(row.new_users),
            engagedSessions: num(row.engaged_sessions),
            sessionSeconds: num(row.avg_session_seconds) * num(row.sessions),
            pageViews: num(row.page_views),
            eventCount: num(row.event_count),
            keyEvents: num(row.key_events),
            revenue: num(row.total_revenue),
          }
        : EMPTY_GA4_SUMS;
      points.push({ date: day, hasData: !!row, ...toGa4Totals(sums) });
    }
    return { propertyId: property.propertyId, period, points };
  }

  async breakdown(
    scope: CompanyAwareScope,
    query: {
      propertyId: string;
      since: string;
      until: string;
      dimension: Ga4Dimension;
      limit?: number;
    },
  ) {
    const property = await this.requireProperty(scope, query.propertyId);
    const period = this.period(query.since, query.until);
    const limit = query.limit ?? DEFAULT_BREAKDOWN_LIMIT;
    const rows = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT dimension_value AS value,
              SUM(sessions) AS sessions, SUM(engaged_sessions) AS engaged_sessions,
              SUM(key_events) AS key_events, SUM(total_revenue) AS revenue
         FROM social_ga4_dimension_daily
        WHERE ${this.scopeSql()} AND property_id = $5 AND dimension = $6
          AND metric_date BETWEEN $7::date AND $8::date
        GROUP BY dimension_value`,
      [
        ...this.params(scope, property.propertyId),
        query.dimension,
        period.since,
        period.until,
      ],
    );
    const items = rows
      .map((row) => {
        const sessions = num(row.sessions);
        const engagedSessions = num(row.engaged_sessions);
        return {
          value: String(row.value),
          isOther: row.value === GA4_OTHER_BUCKET,
          sessions,
          engagedSessions,
          engagementRate: sessions > 0 ? engagedSessions / sessions : null,
          keyEvents: num(row.key_events),
          revenue: num(row.revenue),
        };
      })
      // "(other)" is a remainder, not a competitor: it sorts by size like the
      // rest but is flagged so the UI can label it "Outros".
      .sort((a, b) => b.sessions - a.sessions);

    return {
      propertyId: property.propertyId,
      dimension: query.dimension,
      period,
      items: items.slice(0, limit),
      total: items.length,
    };
  }

  async freshness(scope: CompanyAwareScope, propertyId: string) {
    const property = await this.requireProperty(scope, propertyId);
    const [data] = await this.dataSource.query<
      Array<{ latest: string | null; synced_at: Date | null }>
    >(
      `SELECT to_char(MAX(metric_date), 'YYYY-MM-DD') AS latest,
              MAX(synced_at) AS synced_at
         FROM social_ga4_daily_metrics
        WHERE ${this.scopeSql()} AND property_id = $5`,
      this.params(scope, property.propertyId),
    );
    const [run] = await this.dataSource.query<
      Array<{
        status: string;
        error_code: string | null;
        window_start: string;
        window_end: string;
        finished_at: Date | null;
      }>
    >(
      `SELECT status, error_code, to_char(window_start,'YYYY-MM-DD') AS window_start,
              to_char(window_end,'YYYY-MM-DD') AS window_end, finished_at
         FROM social_ga4_sync_runs
        WHERE ${this.scopeSql()} AND property_id = $5
        ORDER BY created_at DESC LIMIT 1`,
      this.params(scope, property.propertyId),
    );
    const syncedAt = data?.synced_at ?? null;
    return {
      propertyId: property.propertyId,
      latestDataDate: data?.latest ?? null,
      lastSyncedAt: syncedAt?.toISOString() ?? null,
      stale:
        !syncedAt ||
        Date.now() - syncedAt.getTime() > STALE_AFTER_HOURS * 3_600_000,
      lastRun: run
        ? {
            status: run.status,
            errorCode: run.error_code,
            windowStart: run.window_start,
            windowEnd: run.window_end,
            finishedAt: run.finished_at?.toISOString() ?? null,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------- helpers

  private async requireProperty(
    scope: CompanyAwareScope,
    propertyId: string,
  ): Promise<Ga4SelectedProperty> {
    const selected = await this.directory.forScope(scope);
    const property = selected?.properties.find(
      (item) => item.propertyId === propertyId,
    );
    if (!property) throw new NotFoundException('selection_not_found');
    return property;
  }

  private period(since: string, until: string): Ga4Period {
    const period = parseGa4Period(since, until);
    if (!period) throw new BadRequestException('invalid_period');
    return period;
  }

  private scopeSql() {
    return `tenant_id = $1 AND workspace_id = $2
            AND agency_client_id IS NOT DISTINCT FROM $3
            AND company_context_id IS NOT DISTINCT FROM $4`;
  }

  private params(scope: CompanyAwareScope, propertyId: string) {
    return [
      scope.tenantId,
      scope.workspaceId,
      scope.agencyClientId,
      scope.companyContextId,
      propertyId,
    ];
  }

  private async sums(
    scope: CompanyAwareScope,
    propertyId: string,
    period: Ga4Period,
  ): Promise<Ga4Sums> {
    const [row] = await this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT COALESCE(SUM(sessions),0) AS sessions,
              COALESCE(SUM(total_users),0) AS users,
              COALESCE(SUM(new_users),0) AS new_users,
              COALESCE(SUM(engaged_sessions),0) AS engaged_sessions,
              COALESCE(SUM(avg_session_seconds * sessions),0) AS session_seconds,
              COALESCE(SUM(page_views),0) AS page_views,
              COALESCE(SUM(event_count),0) AS event_count,
              COALESCE(SUM(key_events),0) AS key_events,
              COALESCE(SUM(total_revenue),0) AS revenue
         FROM social_ga4_daily_metrics
        WHERE ${this.scopeSql()} AND property_id = $5
          AND metric_date BETWEEN $6::date AND $7::date`,
      [...this.params(scope, propertyId), period.since, period.until],
    );
    return {
      sessions: num(row?.sessions),
      users: num(row?.users),
      newUsers: num(row?.new_users),
      engagedSessions: num(row?.engaged_sessions),
      sessionSeconds: num(row?.session_seconds),
      pageViews: num(row?.page_views),
      eventCount: num(row?.event_count),
      keyEvents: num(row?.key_events),
      revenue: num(row?.revenue),
    };
  }
}
