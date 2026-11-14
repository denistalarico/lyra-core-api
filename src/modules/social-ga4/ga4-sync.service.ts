import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, type EntityManager } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import {
  currentDayIn,
  shiftDay,
} from '../social-integrations/sync/insights-window';
import {
  GoogleCredentialError,
  SocialGoogleAuthorizationService,
} from '../social-google/social-google-authorization.service';
import { GA4_DIMENSIONS, type Ga4Dimension } from './entities';
import { Ga4DataClient, Ga4DataError } from './ga4-data.client';
import {
  GA4_BACKFILL_DAYS,
  GA4_DAILY_LOOKBACK_DAYS,
  GA4_MANUAL_MAX_WINDOW_DAYS,
  GA4_STALE_RUN_MINUTES,
  isGa4SyncEnabled,
} from './ga4-sync.config';
import { Ga4PropertyDirectoryService } from './ga4-property-directory.service';
import {
  GA4_DAILY_METRICS,
  GA4_DIMENSION_API_NAMES,
  GA4_DIMENSION_METRICS,
  normalizeDailyRows,
  normalizeDimensionRows,
} from './ga4.normalizer';

const ZERO_UUID = `'00000000-0000-0000-0000-000000000000'::uuid`;
const CONFLICT_SCOPE = `tenant_id, workspace_id, COALESCE(agency_client_id, ${ZERO_UUID}), COALESCE(company_context_id, ${ZERO_UUID}), property_id`;
const INSERT_CHUNK = 400;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type Ga4SyncTriggerKind = 'scheduled' | 'manual';

export type Ga4SyncResult = {
  runId: string;
  propertyId: string;
  status: 'succeeded' | 'partial' | 'failed';
  windowStart: string;
  windowEnd: string;
  rowsWritten: number;
  apiCalls: number;
  errorCode: string | null;
};

type Counters = { rows: number; calls: number };

/**
 * Pulls GA4 reports into the local read model (D-G5). The only code in the
 * module that talks to Google; screens read the mirror and never reach it.
 *
 * Idempotent: every write is an upsert on the scope-wide key, so `created_at`
 * survives a re-run, and rows the new pass no longer returns are deleted so a
 * day restated by GA4 does not keep a stale tail.
 */
@Injectable()
export class Ga4SyncService {
  private readonly logger = new Logger(Ga4SyncService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly directory: Ga4PropertyDirectoryService,
    private readonly authorizations: SocialGoogleAuthorizationService,
    private readonly client: Ga4DataClient,
  ) {}

  /** The window a scheduled run owes, or null when nothing is due yet. */
  async defaultWindow(
    scope: CompanyAwareScope,
    propertyId: string,
    timeZone: string,
    now: Date = new Date(),
  ): Promise<{ windowStart: string; windowEnd: string }> {
    const yesterday = shiftDay(currentDayIn(timeZone, now), -1);
    const [{ count }] = await this.dataSource.query<Array<{ count: string }>>(
      `SELECT count(*) AS count FROM social_ga4_daily_metrics
        WHERE tenant_id = $1 AND workspace_id = $2
          AND agency_client_id IS NOT DISTINCT FROM $3
          AND company_context_id IS NOT DISTINCT FROM $4
          AND property_id = $5`,
      this.scopeParams(scope, propertyId),
    );
    const lookback =
      Number(count) === 0 ? GA4_BACKFILL_DAYS : GA4_DAILY_LOOKBACK_DAYS;
    return {
      windowStart: shiftDay(yesterday, -(lookback - 1)),
      windowEnd: yesterday,
    };
  }

  /**
   * Whether this property already owes nothing today: a run that covers
   * yesterday finished today (property zone), failed less than three hours ago
   * (no hourly hammering of a dead credential) or is still running.
   */
  async hasFinishedRunFor(
    scope: CompanyAwareScope,
    propertyId: string,
    timeZone: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const today = currentDayIn(timeZone, now);
    const yesterday = shiftDay(today, -1);
    const rows = await this.dataSource.query<unknown[]>(
      `SELECT 1 FROM social_ga4_sync_runs
        WHERE tenant_id = $1 AND workspace_id = $2
          AND agency_client_id IS NOT DISTINCT FROM $3
          AND company_context_id IS NOT DISTINCT FROM $4
          AND property_id = $5
          AND window_end >= $6::date
          AND (
            status = 'processing'
            OR (status IN ('succeeded','partial')
                AND (started_at AT TIME ZONE $7)::date = $8::date)
            OR (status = 'failed' AND started_at > $9::timestamptz - interval '3 hours')
          )
        LIMIT 1`,
      [
        ...this.scopeParams(scope, propertyId),
        yesterday,
        timeZone,
        today,
        now.toISOString(),
      ],
    );
    return rows.length > 0;
  }

  async syncProperty(input: {
    scope: CompanyAwareScope;
    propertyId: string;
    trigger: Ga4SyncTriggerKind;
    windowStart?: string;
    windowEnd?: string;
    now?: Date;
  }): Promise<Ga4SyncResult> {
    if (!isGa4SyncEnabled()) {
      throw new ServiceUnavailableException('ga4_sync_disabled');
    }
    const selected = await this.directory.forScope(input.scope);
    const property = selected?.properties.find(
      (item) => item.propertyId === input.propertyId,
    );
    if (!selected || !property) {
      throw new NotFoundException('selection_not_found');
    }
    // B-05: a property's day is in its own zone; never fall back to UTC.
    if (!property.timeZone) {
      throw new BadRequestException('property_timezone_missing');
    }

    const window = await this.resolveWindow(input, property.timeZone);
    await this.recoverStaleRuns(input.scope);
    const runId = await this.openRun(
      input.scope,
      input.propertyId,
      input.trigger,
      window,
    );

    const counters: Counters = { rows: 0, calls: 0 };
    let status: Ga4SyncResult['status'] = 'succeeded';
    let errorCode: string | null = null;
    try {
      const { accessToken } = await this.authorizations.getAccessToken({
        scope: input.scope,
        product: 'ga4',
      });
      const ctx = {
        scope: input.scope,
        authorizationId: selected.authorizationId,
        propertyId: input.propertyId,
        runId,
        accessToken,
        window,
        counters,
      };
      await this.syncDaily(ctx);
      for (const dimension of GA4_DIMENSIONS) {
        try {
          const truncated = await this.syncDimension(ctx, dimension);
          if (truncated) status = 'partial';
        } catch (error) {
          // A failed breakdown leaves the headline numbers valid: partial, and
          // keep going unless the failure is the whole property's (auth/quota).
          if (this.isFatalForRun(error)) throw error;
          status = 'partial';
          errorCode = this.codeOf(error);
        }
      }
    } catch (error) {
      status = 'failed';
      errorCode = this.codeOf(error);
      this.logger.warn(`ga4 sync failed: ${errorCode}`);
    }

    await this.closeRun(runId, status, errorCode, counters);
    return {
      runId,
      propertyId: input.propertyId,
      status,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      rowsWritten: counters.rows,
      apiCalls: counters.calls,
      errorCode,
    };
  }

  /** Manual endpoint helper: failures the caller can act on become HTTP errors. */
  throwIfActionable(result: Ga4SyncResult): void {
    if (result.status !== 'failed') return;
    switch (result.errorCode) {
      case 'reauth_required':
      case 'scope_not_granted':
        throw new ConflictException('reauth_required');
      case 'permission_denied':
        throw new ForbiddenException('permission_denied');
      case 'not_connected':
      case 'product_not_connected':
        throw new NotFoundException(result.errorCode);
      default:
    }
  }

  // ---------------------------------------------------------------- windows

  private async resolveWindow(
    input: {
      trigger: Ga4SyncTriggerKind;
      windowStart?: string;
      windowEnd?: string;
      scope: CompanyAwareScope;
      propertyId: string;
      now?: Date;
    },
    timeZone: string,
  ) {
    if (!input.windowStart && !input.windowEnd) {
      return this.defaultWindow(
        input.scope,
        input.propertyId,
        timeZone,
        input.now,
      );
    }
    const { windowStart, windowEnd } = input;
    if (
      !windowStart ||
      !windowEnd ||
      !DAY.test(windowStart) ||
      !DAY.test(windowEnd)
    ) {
      throw new BadRequestException('invalid_window');
    }
    const yesterday = shiftDay(currentDayIn(timeZone, input.now), -1);
    if (windowStart > windowEnd || windowEnd > yesterday) {
      throw new BadRequestException('invalid_window');
    }
    const span = Math.round(
      (Date.parse(windowEnd) - Date.parse(windowStart)) / 86_400_000,
    );
    if (Number.isNaN(span) || span + 1 > GA4_MANUAL_MAX_WINDOW_DAYS) {
      throw new BadRequestException('window_too_large');
    }
    return { windowStart, windowEnd };
  }

  // ------------------------------------------------------------------ runs

  private scopeParams(scope: CompanyAwareScope, propertyId: string) {
    return [
      scope.tenantId,
      scope.workspaceId,
      scope.agencyClientId,
      scope.companyContextId,
      propertyId,
    ];
  }

  private async recoverStaleRuns(scope: CompanyAwareScope) {
    await this.dataSource.query(
      `UPDATE social_ga4_sync_runs
          SET status = 'failed', error_code = 'stale_run', finished_at = now()
        WHERE status = 'processing'
          AND started_at < now() - make_interval(mins => $5::int)
          AND tenant_id = $1 AND workspace_id = $2
          AND agency_client_id IS NOT DISTINCT FROM $3
          AND company_context_id IS NOT DISTINCT FROM $4`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId,
        GA4_STALE_RUN_MINUTES,
      ],
    );
  }

  private async openRun(
    scope: CompanyAwareScope,
    propertyId: string,
    trigger: Ga4SyncTriggerKind,
    window: { windowStart: string; windowEnd: string },
  ): Promise<string> {
    try {
      const [row] = await this.dataSource.query<Array<{ id: string }>>(
        `INSERT INTO social_ga4_sync_runs
           (tenant_id, workspace_id, agency_client_id, company_context_id,
            property_id, trigger, window_start, window_end)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          scope.tenantId,
          scope.workspaceId,
          scope.agencyClientId,
          scope.companyContextId,
          propertyId,
          trigger,
          window.windowStart,
          window.windowEnd,
        ],
      );
      return row.id;
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '23505'
      ) {
        throw new ConflictException('sync_in_progress');
      }
      throw error;
    }
  }

  private async closeRun(
    runId: string,
    status: Ga4SyncResult['status'],
    errorCode: string | null,
    counters: Counters,
  ) {
    await this.dataSource.query(
      `UPDATE social_ga4_sync_runs
          SET status = $2, error_code = $3, rows_written = $4,
              api_calls = $5, finished_at = now()
        WHERE id = $1`,
      [runId, status, errorCode, counters.rows, counters.calls],
    );
  }

  // --------------------------------------------------------------- reports

  private async syncDaily(ctx: SyncContext) {
    const report = await this.client.runReport(ctx.accessToken, {
      propertyId: ctx.propertyId,
      startDate: ctx.window.windowStart,
      endDate: ctx.window.windowEnd,
      dimensions: ['date'],
      metrics: [...GA4_DAILY_METRICS],
    });
    ctx.counters.calls += report.apiCalls;
    const rows = normalizeDailyRows(report.rows);

    await this.dataSource.transaction(async (manager) => {
      await this.upsert(
        manager,
        'social_ga4_daily_metrics',
        [
          'metric_date',
          'sessions',
          'total_users',
          'new_users',
          'engaged_sessions',
          'event_count',
          'key_events',
          'page_views',
          'total_revenue',
          'avg_session_seconds',
        ],
        rows.map((row) => [
          row.metricDate,
          row.sessions,
          row.totalUsers,
          row.newUsers,
          row.engagedSessions,
          row.eventCount,
          row.keyEvents,
          row.pageViews,
          row.totalRevenue,
          row.avgSessionSeconds,
        ]),
        `${CONFLICT_SCOPE}, metric_date`,
        ctx,
        report.truncated,
      );
      await this.deleteStale(manager, 'social_ga4_daily_metrics', ctx, null);
    });
    ctx.counters.rows += rows.length;
  }

  /** Returns whether the report hid part of the data. */
  private async syncDimension(
    ctx: SyncContext,
    dimension: Ga4Dimension,
  ): Promise<boolean> {
    const report = await this.client.runReport(ctx.accessToken, {
      propertyId: ctx.propertyId,
      startDate: ctx.window.windowStart,
      endDate: ctx.window.windowEnd,
      dimensions: ['date', GA4_DIMENSION_API_NAMES[dimension]],
      metrics: [...GA4_DIMENSION_METRICS],
    });
    ctx.counters.calls += report.apiCalls;
    const rows = normalizeDimensionRows(dimension, report.rows);

    await this.dataSource.transaction(async (manager) => {
      await this.upsert(
        manager,
        'social_ga4_dimension_daily',
        [
          'metric_date',
          'dimension',
          'dimension_value',
          'sessions',
          'engaged_sessions',
          'total_users',
          'key_events',
          'total_revenue',
        ],
        rows.map((row) => [
          row.metricDate,
          row.dimension,
          row.value,
          row.sessions,
          row.engagedSessions,
          row.totalUsers,
          row.keyEvents,
          row.totalRevenue,
        ]),
        `${CONFLICT_SCOPE}, metric_date, dimension, dimension_value`,
        ctx,
        report.truncated,
      );
      await this.deleteStale(
        manager,
        'social_ga4_dimension_daily',
        ctx,
        dimension,
      );
    });
    ctx.counters.rows += rows.length;
    return report.truncated;
  }

  /**
   * Batched upsert. Scope columns are shared by every row of a run, so only the
   * varying columns travel per row. `created_at` is absent from the update list,
   * which is what keeps it across re-runs.
   */
  private async upsert(
    manager: EntityManager,
    table: string,
    columns: string[],
    rows: Array<Array<string | number>>,
    conflictTarget: string,
    ctx: SyncContext,
    isPartial: boolean,
  ) {
    const fixed = [
      'tenant_id',
      'workspace_id',
      'agency_client_id',
      'company_context_id',
      'authorization_id',
      'property_id',
      'is_partial',
      'sync_run_id',
    ];
    const all = [...fixed, ...columns];
    const update = [...columns, 'is_partial', 'authorization_id', 'sync_run_id']
      .map((column) => `${column} = EXCLUDED.${column}`)
      .concat('synced_at = now()', 'updated_at = now()')
      .join(', ');

    for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
      const chunk = rows.slice(start, start + INSERT_CHUNK);
      const params: Array<string | number | boolean | null> = [];
      const tuples = chunk.map((row) => {
        const base = params.length;
        params.push(
          ctx.scope.tenantId,
          ctx.scope.workspaceId,
          ctx.scope.agencyClientId,
          ctx.scope.companyContextId,
          ctx.authorizationId,
          ctx.propertyId,
          isPartial,
          ctx.runId,
          ...row,
        );
        return `(${all.map((_, index) => `$${base + index + 1}`).join(',')})`;
      });
      await manager.query(
        `INSERT INTO ${table} (${all.join(',')}) VALUES ${tuples.join(',')}
         ON CONFLICT (${conflictTarget}) DO UPDATE SET ${update}`,
        params,
      );
    }
  }

  /** Drops window rows this pass did not write (days GA4 restated away). */
  private async deleteStale(
    manager: EntityManager,
    table: string,
    ctx: SyncContext,
    dimension: Ga4Dimension | null,
  ) {
    await manager.query(
      `DELETE FROM ${table}
        WHERE tenant_id = $1 AND workspace_id = $2
          AND agency_client_id IS NOT DISTINCT FROM $3
          AND company_context_id IS NOT DISTINCT FROM $4
          AND property_id = $5
          AND metric_date BETWEEN $6 AND $7
          AND sync_run_id IS DISTINCT FROM $8
          ${dimension ? 'AND dimension = $9' : ''}`,
      [
        ...this.scopeParams(ctx.scope, ctx.propertyId),
        ctx.window.windowStart,
        ctx.window.windowEnd,
        ctx.runId,
        ...(dimension ? [dimension] : []),
      ],
    );
  }

  // ----------------------------------------------------------------- errors

  private isFatalForRun(error: unknown): boolean {
    if (error instanceof GoogleCredentialError) return true;
    if (error instanceof Ga4DataError) {
      return (
        error.code === 'reauth_required' ||
        error.code === 'permission_denied' ||
        error.code === 'rate_limited'
      );
    }
    return true;
  }

  /** Only codes: provider bodies and stack traces never reach the run row. */
  private codeOf(error: unknown): string {
    if (error instanceof Ga4DataError) return error.code;
    if (error instanceof GoogleCredentialError) return error.code;
    return 'internal_error';
  }
}

type SyncContext = {
  scope: CompanyAwareScope;
  authorizationId: string;
  propertyId: string;
  runId: string;
  accessToken: string;
  window: { windowStart: string; windowEnd: string };
  counters: Counters;
};
