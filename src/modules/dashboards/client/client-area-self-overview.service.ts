import { Injectable, Logger } from '@nestjs/common';
import type { ClientAreaSelfContext } from '../../client-area/client-area.types';
import { AgencyDashboardsService } from '../services/agency-dashboards.service';
import type {
  AgencyDashboardOverviewResponse,
  AgencyDashboardPriority,
} from '../types';
import type {
  ClientAreaSelfAlert,
  ClientAreaSelfClients,
  ClientAreaSelfFinance,
  ClientAreaSelfOperations,
  ClientAreaSelfOverviewResponse,
  ClientAreaSelfPeriod,
  ClientAreaSelfProfitability,
  ClientAreaSelfSlice,
} from './client-area-self-overview.types';

/**
 * PD4 — projects the agency's own canonical dashboard into the Client Area
 * self-context.
 *
 * WHY IT OWNS NO OPERATIONAL LOGIC
 * --------------------------------
 * There is exactly one query in this class, and it is a call to
 * `AgencyDashboardsService.getOverview` — the application service the Agency
 * dashboard itself uses. Everything below it is `source field → DTO field`.
 * That is the whole point of §5/§6: the Client Area must not become an
 * aggregator wired to other modules' tables, and no figure may be computed
 * twice in the product. If a number here is wrong, it is wrong on the Agency
 * dashboard too, and it gets fixed there.
 *
 * WHY IT LIVES IN `dashboards/` AND NOT IN `client-area/`
 * -------------------------------------------------------
 * Same reason AP3's surface lives in `social-approvals/client/`: the arrow
 * points Client Area → domain. `ClientAreaModule` imports no domain module at
 * all (by design), and making it import `DashboardsModule` would drag Finance,
 * Projects, Clients, Activities, Team, Calendar and Platform into the module
 * graph of every spec that touches Client Area authentication. The bridging
 * module (`ClientAreaSelfOverviewModule`) imports both sides instead, and
 * neither side knows about it.
 *
 * WHY THE SELF CONTEXT IS SAFE TO PASS HERE
 * -----------------------------------------
 * `getOverview` takes a plain `RequestContext` — `tenantId`, `workspaceId`,
 * `userId`, `role` — and reads **no** `managedContext`. So the self-context
 * supplies the agency's own four values and nothing company-shaped exists to
 * leak. This is also why `toCompanyAwareScope` is never called: the self
 * context has no company fields to give it, and would not typecheck (PD3 §9).
 */
@Injectable()
export class ClientAreaSelfOverviewService {
  private readonly logger = new Logger(ClientAreaSelfOverviewService.name);

  constructor(private readonly dashboards: AgencyDashboardsService) {}

  async getOverview(
    context: ClientAreaSelfContext,
  ): Promise<ClientAreaSelfOverviewResponse> {
    const generatedAt = new Date().toISOString();

    let overview: AgencyDashboardOverviewResponse | null = null;
    try {
      /**
       * The Agency role is **not** taken from the request — it is read from
       * the `workspace_users` row that `ClientAreaSelfAccessService` already
       * re-validated this request (PD3 §7), and the self-context only exists
       * for an active Owner/Admin. Passing `'owner'`/`'admin'` would be
       * hard-coding what that check established; passing the stored Client
       * Area role would mean handing an Agency service a vocabulary it does
       * not speak. So the Agency role travels on the self context, resolved
       * where it is owned.
       */
      overview = await this.dashboards.getOverview(
        {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          userId: context.userId,
          role: context.agencyRole,
        },
        {},
      );
    } catch (error) {
      // The whole canonical source is gone (Agency entitlement off, platform
      // context unavailable). Every slice is unavailable; the surface still
      // renders and says so, rather than 500-ing a landing page (§23).
      this.logger.warn(
        `Client Area self overview: canonical dashboard unavailable (${
          error instanceof Error ? error.name : 'unknown error'
        }).`,
      );
      return this.allUnavailable(generatedAt, context, 'source_failed');
    }

    const failed = new Set(
      overview.partialFailures.map((failure) => failure.source),
    );

    return {
      generatedAt,
      agencyDisplayName: context.agencyDisplayName,
      period: this.resolvePeriod(overview),
      finance: this.projectFinance(overview, failed),
      profitability: this.projectProfitability(overview, failed),
      operations: this.projectOperations(overview, failed),
      clients: this.projectClients(overview, failed),
      alerts: this.projectAlerts(overview),
    };
  }

  /**
   * The period comes from Finance's own `period`, falling back to
   * Profitability's, because those are the two slices whose figures are
   * period-bound and both report the month they computed. Only if neither
   * answered is the month derived here — and then no money figure is being
   * shown next to it anyway.
   */
  private resolvePeriod(
    overview: AgencyDashboardOverviewResponse,
  ): ClientAreaSelfPeriod {
    const financePeriod = overview.widgets.finance?.period;
    if (financePeriod?.start && financePeriod.end) {
      return {
        type: 'current_month',
        start: financePeriod.start,
        end: financePeriod.end,
      };
    }

    const profitability = this.readProfitability(overview);
    const period = profitability?.period;
    if (
      period &&
      typeof period.start === 'string' &&
      typeof period.end === 'string'
    ) {
      return { type: 'current_month', start: period.start, end: period.end };
    }

    const now = new Date();
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    );
    return {
      type: 'current_month',
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }

  private projectFinance(
    overview: AgencyDashboardOverviewResponse,
    failed: Set<string>,
  ): ClientAreaSelfSlice<ClientAreaSelfFinance> {
    const finance = overview.widgets.finance;
    if (!finance) {
      return this.unavailable(failed.has('finance'));
    }

    /**
     * `expenses` and `result` are Finance's own definitions, not arithmetic
     * invented here: `finance.service.ts` computes
     * `totalCosts = fixedCosts + variableCosts` and then
     * `netMargin = (revenueIssued - totalCosts) / revenueIssued`. Reproducing
     * those two lines keeps the executive card consistent with the Agency
     * Finance screen; inventing a different notion of "despesas" would make
     * the two surfaces disagree, which is worse than showing fewer cards.
     *
     * Deliberately NOT projected: `mrr` (the dashboard overwrites it with the
     * client-portfolio revenue, so its meaning depends on another widget),
     * `defaultRate`/`breakEvenPoint`/`averageTicket` (ratios that need their
     * own explanation to read safely) and every `counts.*` field (document
     * inventory, not an executive signal).
     */
    const expenses = finance.metrics.fixedCosts + finance.metrics.variableCosts;

    return {
      status: 'ok',
      currency: finance.currency,
      revenueIssued: finance.metrics.revenueIssued,
      revenueReceived: finance.metrics.revenueReceived,
      expenses,
      result: finance.metrics.revenueIssued - expenses,
      openReceivables: finance.metrics.openReceivables,
      overdueReceivables: finance.metrics.overdueReceivables,
    };
  }

  private projectProfitability(
    overview: AgencyDashboardOverviewResponse,
    failed: Set<string>,
  ): ClientAreaSelfSlice<ClientAreaSelfProfitability> {
    const profitability = this.readProfitability(overview);
    const summary = profitability?.summary;
    if (!summary) {
      return this.unavailable(failed.has('profitability'));
    }

    /**
     * Straight from `FinanceProfitabilityService`'s own summary, including its
     * `health`, which is the canonical classification against the workspace's
     * configured margin thresholds. §10 forbids recomputing cost or margin and
     * §36 forbids inventing a verdict — so neither happens: `margin` is
     * copied, and `health` is the domain's own word for it.
     *
     * `cost` is `directCosts + laborCost`, the two components that service
     * reports and sums into its own `grossProfit`. It is a DIRECT margin: no
     * overhead is allocated (that service says so in its `notes`), and the UI
     * must not relabel it as a net result.
     */
    const directCosts = this.toNumber(summary.directCosts);
    const laborCost = this.toNumber(summary.laborCost);

    return {
      status: 'ok',
      currency:
        typeof profitability?.currency === 'string'
          ? profitability.currency
          : '',
      revenue: this.toNumber(summary.revenue),
      cost: directCosts + laborCost,
      grossProfit: this.toNumber(summary.grossProfit),
      margin: this.toNumber(summary.margin),
      health: typeof summary.health === 'string' ? summary.health : null,
    };
  }

  private projectOperations(
    overview: AgencyDashboardOverviewResponse,
    failed: Set<string>,
  ): ClientAreaSelfSlice<ClientAreaSelfOperations> {
    const projects = overview.widgets.projects;
    const activities = overview.widgets.activities;

    if (!projects && !activities) {
      return this.unavailable(
        failed.has('projects') || failed.has('activities'),
      );
    }

    /**
     * Counts only. `attentionItems` is deliberately not projected: those
     * entries carry task titles, `assigneeId`, `blockedReason` and
     * `visibility: 'private'` — internal operational detail that §11 and §21
     * keep out of this surface. An executive overview needs the magnitude of
     * the backlog, not the contents of it.
     *
     * `openActivities` is derived from the activity status map the summary
     * already groups, because that service exposes `total` (including closed)
     * and `overdue`, but no single "open" figure.
     */
    return {
      status: 'ok',
      activeProjects: projects?.projects.active ?? 0,
      overdueProjects: projects?.projects.overdue ?? 0,
      openTasks: projects?.tasks.open ?? 0,
      overdueTasks: projects?.tasks.overdue ?? 0,
      dueTodayTasks: projects?.tasks.dueToday ?? 0,
      openActivities: this.countOpenActivities(activities?.byStatus),
      overdueActivities: activities?.overdue ?? 0,
    };
  }

  /**
   * Open = not in a terminal state, mirroring the `closedStatuses` list
   * `ActivitiesService.getSummary` uses for its own `overdue`/`myOpen`
   * queries. Named here rather than re-queried, so the two agree.
   */
  private countOpenActivities(
    byStatus: Record<string, number> | undefined,
  ): number {
    if (!byStatus) return 0;
    const closed = new Set(['done', 'cancelled', 'archived']);
    return Object.entries(byStatus).reduce(
      (total, [status, count]) =>
        closed.has(status) ? total : total + this.toNumber(count),
      0,
    );
  }

  private projectClients(
    overview: AgencyDashboardOverviewResponse,
    failed: Set<string>,
  ): ClientAreaSelfSlice<ClientAreaSelfClients> {
    const clients = overview.widgets.clients;
    if (!clients) {
      return this.unavailable(failed.has('clients'));
    }

    /**
     * `active`/`archived`/`total` are the Clients module's own definitions
     * (`active = total - archived`). Onboarding and offboarding are counted
     * from the in-progress lifecycle processes that summary already returns —
     * their `clientId`, `id` and Agency `href` are dropped, because the
     * executive signal is how many are in flight, not which.
     *
     * `byHealthStatus` is NOT projected as a client-facing figure: the health
     * classification reaches this surface only through the canonical alerts
     * below, where the domain's own wording travels with it (§12, §36).
     */
    const onboarding = clients.lifecycleProcesses.filter(
      (process) => process.processType === 'onboarding',
    ).length;
    const offboarding = clients.lifecycleProcesses.filter(
      (process) => process.processType === 'offboarding',
    ).length;

    return {
      status: 'ok',
      total: clients.total,
      active: clients.active,
      archived: clients.archived,
      onboarding,
      offboarding,
    };
  }

  /**
   * The canonical priority engine, filtered rather than re-ranked.
   *
   * `AgencyDashboardPrioritiesService` already decides what deserves attention
   * and how severe it is, so §16's "no new priority heuristic" is satisfied by
   * not having one: the order it produced is preserved.
   *
   * Only the three aggregate-derived sources pass. Project and task priorities
   * are excluded for two independent reasons: their `entityId` is a real
   * entity id and their `href` is an Agency route (§21, §37), and their
   * `description` is the project or task title — operational detail this
   * surface deliberately keeps out (§11). What remains (overdue receivables,
   * default rate, negative margin, below break-even, overdue activities,
   * client health) is aggregate by construction: those entries carry a
   * constant slug as `entityId` and no entity reference at all.
   */
  private projectAlerts(
    overview: AgencyDashboardOverviewResponse,
  ): ClientAreaSelfSlice<{ items: ClientAreaSelfAlert[] }> {
    const allowed = new Set(['finance', 'clients', 'activities']);
    const items = overview.priorities
      .filter((priority) => allowed.has(priority.sourceModule))
      .map((priority) => this.projectAlert(priority));

    return { status: 'ok', items };
  }

  private projectAlert(priority: AgencyDashboardPriority): ClientAreaSelfAlert {
    return {
      key: priority.id,
      severity: priority.severity,
      title: priority.title,
      description: priority.description,
      source: priority.sourceModule as ClientAreaSelfAlert['source'],
    };
  }

  /**
   * A missing widget has two causes, and they are different facts: the
   * canonical source threw (it is in `partialFailures`), or the role/plan does
   * not include that domain (`access.canView*` was false, so the dashboard
   * resolved it to `null` without failing). Neither is a zero (§7).
   */
  private unavailable<TData>(
    sourceFailed: boolean,
  ): ClientAreaSelfSlice<TData> {
    return {
      status: 'unavailable',
      reason: sourceFailed ? 'source_failed' : 'not_available',
    };
  }

  private allUnavailable(
    generatedAt: string,
    context: ClientAreaSelfContext,
    reason: 'source_failed' | 'not_available',
  ): ClientAreaSelfOverviewResponse {
    const now = new Date();
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    );

    const slice = { status: 'unavailable', reason } as const;

    return {
      generatedAt,
      agencyDisplayName: context.agencyDisplayName,
      period: {
        type: 'current_month',
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10),
      },
      finance: slice,
      profitability: slice,
      operations: slice,
      clients: slice,
      alerts: slice,
    };
  }

  /** The profitability widget is `Record<string, unknown>` at the boundary. */
  private readProfitability(overview: AgencyDashboardOverviewResponse): {
    currency?: unknown;
    period?: { start?: unknown; end?: unknown };
    summary?: Record<string, unknown>;
  } | null {
    const value = overview.widgets.profitability;
    if (!value || typeof value !== 'object') return null;

    const record = value as Record<string, unknown>;
    const summary =
      record.summary && typeof record.summary === 'object'
        ? (record.summary as Record<string, unknown>)
        : undefined;
    const period =
      record.period && typeof record.period === 'object'
        ? (record.period as { start?: unknown; end?: unknown })
        : undefined;

    return { currency: record.currency, period, summary };
  }

  private toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
