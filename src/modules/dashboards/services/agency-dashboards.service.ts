import { ForbiddenException, Injectable } from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { ActivitiesService } from '../../activities/services/activities.service';
import { CalendarDashboardQueryService } from '../../calendar/calendar-dashboard-query.service';
import { AgencySalesService } from '../../agency/agency-sales.service';
import { ClientsProfitabilityService } from '../../clients/services/clients-profitability.service';
import { ClientsService } from '../../clients/services/clients.service';
import { FinanceProfitabilityService } from '../../finance/services/finance-profitability.service';
import type { FinanceRequestContext } from '../../finance/services/finance-context';
import { FinanceService } from '../../finance/services/finance.service';
import { PlatformContextService } from '../../platform/platform-context.service';
import { ProjectsDashboardQueryService } from '../../projects/services/projects-dashboard-query.service';
import { TeamDashboardQueryService } from '../../team/services/team-dashboard-query.service';
import type {
  AgencyDashboardActivitiesWidget,
  AgencyDashboardActivityItem,
  AgencyDashboardClientsWidget,
  AgencyDashboardFinanceWidget,
  AgencyDashboardOverviewResponse,
  AgencyDashboardPartialFailure,
  AgencyDashboardProfitabilityWidget,
  AgencyDashboardSalesWidget,
} from '../types';
import { AgencyDashboardAccessService } from './agency-dashboard-access.service';
import { AgencyDashboardPrioritiesService } from './agency-dashboard-priorities.service';

type GetAgencyDashboardOverviewOptions = {
  clientId?: string;
  market?: 'US' | 'BR' | 'ALL';
};

type DashboardSource =
  | 'projects'
  | 'finance'
  | 'profitability'
  | 'clients'
  | 'clientsProfitability'
  | 'sales'
  | 'activities'
  | 'calendar'
  | 'team';

@Injectable()
export class AgencyDashboardsService {
  constructor(
    private readonly platformContextService: PlatformContextService,
    private readonly projectsDashboardQueryService: ProjectsDashboardQueryService,
    private readonly calendarDashboardQueryService: CalendarDashboardQueryService,
    private readonly teamDashboardQueryService: TeamDashboardQueryService,
    private readonly financeService: FinanceService,
    private readonly financeProfitabilityService: FinanceProfitabilityService,
    private readonly clientsService: ClientsService,
    private readonly clientsProfitabilityService: ClientsProfitabilityService,
    private readonly agencySalesService: AgencySalesService,
    private readonly activitiesService: ActivitiesService,
    private readonly accessService: AgencyDashboardAccessService,
    private readonly prioritiesService: AgencyDashboardPrioritiesService,
  ) {}

  async getOverview(
    context: RequestContext,
    options: GetAgencyDashboardOverviewOptions,
  ): Promise<AgencyDashboardOverviewResponse> {
    const tenantId = this.requireValue(context.tenantId, 'tenantId');
    const workspaceId = this.requireValue(context.workspaceId, 'workspaceId');
    const userId = this.requireValue(context.userId, 'userId');
    const role = context.role ?? 'member';

    const platformContext = await this.platformContextService.getContext({
      tenantId,
      workspaceId,
      userId,
      role,
    });

    const access = this.accessService.resolveAccess(platformContext);

    if (!access.canViewDashboard) {
      throw new ForbiddenException(
        'The Agency product is not available in the active tenant context.',
      );
    }

    const preset = this.accessService.resolvePreset(role);

    const domainContext = {
      tenantId,
      workspaceId,
      userId,
      role,
    };

    const financeContext: FinanceRequestContext = {
      tenantId,
      workspaceId,
      userId,
    };

    const sourcePromises = {
      projects: this.projectsDashboardQueryService.getOverview(
        {
          tenantId,
          workspaceId,
          userId,
        },
        {
          scope: preset === 'member' ? 'personal' : 'workspace',
          userId,
          clientId: options.clientId,
          ownerId: preset === 'management' ? userId : undefined,
          dueSoonDays: 7,
          priorityLimit: 8,
        },
      ),

      finance: access.canViewFinance
        ? this.financeService.getReportsOverview(financeContext)
        : Promise.resolve(null),

      profitability: access.canViewProfitability
        ? this.financeProfitabilityService.getOverview(financeContext)
        : Promise.resolve(null),

      clients: access.canViewPortfolio
        ? this.clientsService.summary(domainContext)
        : Promise.resolve(null),

      clientsProfitability: access.canViewProfitability
        ? this.clientsProfitabilityService.getPortfolio(domainContext)
        : Promise.resolve(null),

      sales: access.canViewCommercial
        ? this.agencySalesService.getOverview({
            tenantId,
            workspaceId,
            userId,
          })
        : Promise.resolve(null),

      activities: this.activitiesService.getSummary(domainContext),



      calendar: this.calendarDashboardQueryService.getSummary({


        tenantId,


        workspaceId,


        userId,


      }),



      team: access.canViewTeam


        ? this.teamDashboardQueryService.getSummary({


            tenantId,


            workspaceId,


          })


        : Promise.resolve(null),
    };

    const sourceEntries = Object.entries(sourcePromises) as Array<
      [DashboardSource, Promise<unknown>]
    >;

    const settledResults = await Promise.allSettled(
      sourceEntries.map(([, promise]) => promise),
    );

    const partialFailures: AgencyDashboardPartialFailure[] = [];

    const values = new Map<DashboardSource, unknown>();

    settledResults.forEach((result, index) => {
      const source = sourceEntries[index][0];

      if (result.status === 'fulfilled') {
        values.set(source, result.value);
        return;
      }

      partialFailures.push({
        source,
        message: this.resolveErrorMessage(
          result.reason,
          `Não foi possível carregar o widget ${source}.`,
        ),
      });

      values.set(source, null);
    });

    const projects = this.resolveProjectsValue(values.get('projects'));

    const finance = this.mapFinanceWidget(values.get('finance'));

    const profitability = this.mapProfitabilityWidget(
      values.get('profitability'),
    );

    const clients = this.mapClientsWidget(
      values.get('clients'),
      values.get('clientsProfitability'),
    );

    // MRR reflects the client portfolio revenue ("Receita da carteira" in the
    // Clients module), not the finance recurring-profile sum.
    const portfolioRevenue = this.extractPortfolioRevenue(
      values.get('clientsProfitability'),
    );
    if (finance && portfolioRevenue !== null) {
      finance.metrics.mrr = portfolioRevenue;
    }

    const sales = this.mapSalesWidget(values.get('sales'));

    const activities = this.mapActivitiesWidget(


      values.get('activities'),


    );



    const calendar = this.resolveCalendarValue(


      values.get('calendar'),


    );



    const team = this.resolveTeamValue(


      values.get('team'),


    );

    await this.enrichAssigneeNames(
      { tenantId, workspaceId },
      projects,
      activities,
    );

    const priorities = this.prioritiesService.build(
      projects,
      preset,
      {
        finance,
        clients,
        activities,
      },
    );

    const agencyProduct = platformContext.products.find(
      (product) => product.key === 'agency',
    );

    const marketSelection = this.resolveMarkets(options.market);

    return {
      generatedAt: new Date().toISOString(),

      product: {
        key: 'agency',
        moduleKey: 'agency.dashboard',
        entitlementStatus: agencyProduct?.status ?? 'inactive',
      },

      context: {
        tenantId,
        workspaceId,
        accountType: platformContext.account.type,
        accountStatus: platformContext.account.status,
        accountDisplayName: platformContext.account.displayName,
        managedTenantId: null,
        agencyClientId: null,
      },

      user: {
        id: userId,
        role,
        preset,
      },

      access,

      greeting: {
        attentionCount: priorities.length,
        messageKey:
          priorities.length === 0
            ? 'dashboard.stable'
            : preset === 'member'
              ? 'dashboard.personalAttention'
              : 'dashboard.attention',
      },

      priorities,

      widgets: {
        projects,
        finance,
        profitability,
        clients,
        sales,
        activities,
        calendar,
        team,
      },

      opportunities: {
        trends: {
          status: 'pending_integration',
          markets: marketSelection,
          items: [],
        },
        dates: {
          status: 'pending_integration',
          markets: marketSelection,
          items: [],
        },
        dailyTip: {
          status: 'pending_integration',
          item: null,
        },
      },

      partialFailures,
    };
  }

  private async enrichAssigneeNames(
    context: { tenantId: string; workspaceId: string },
    projects: AgencyDashboardOverviewResponse['widgets']['projects'],
    activities: AgencyDashboardActivitiesWidget | null,
  ): Promise<void> {
    const userIds = new Set<string>();

    for (const item of projects?.tasks.attentionItems ?? []) {
      if (item.assigneeId) userIds.add(item.assigneeId);
    }

    for (const item of projects?.personalTasks.attentionItems ?? []) {
      if (item.assigneeId) userIds.add(item.assigneeId);
    }

    for (const item of activities?.items ?? []) {
      if (item.assignedToId) userIds.add(item.assignedToId);
    }

    if (userIds.size === 0) {
      return;
    }

    const names = await this.teamDashboardQueryService.getMemberNamesByUserIds(
      context,
      Array.from(userIds),
    );

    for (const item of projects?.tasks.attentionItems ?? []) {
      item.assigneeName = item.assigneeId
        ? (names.get(item.assigneeId) ?? null)
        : null;
    }

    for (const item of projects?.personalTasks.attentionItems ?? []) {
      item.assigneeName = item.assigneeId
        ? (names.get(item.assigneeId) ?? null)
        : null;
    }

    for (const item of activities?.items ?? []) {
      item.assignedToName = item.assignedToId
        ? (names.get(item.assignedToId) ?? null)
        : null;
    }
  }

  private resolveProjectsValue(value: unknown) {
    if (!value || typeof value !== 'object') {
      return null;
    }

    return value as AgencyDashboardOverviewResponse['widgets']['projects'];
  }

  private resolveCalendarValue(
    value: unknown,
  ): AgencyDashboardOverviewResponse['widgets']['calendar'] {
    if (!value || typeof value !== 'object') {
      return null;
    }

    return value as AgencyDashboardOverviewResponse['widgets']['calendar'];
  }

  private resolveTeamValue(
    value: unknown,
  ): AgencyDashboardOverviewResponse['widgets']['team'] {
    if (!value || typeof value !== 'object') {
      return null;
    }

    return value as AgencyDashboardOverviewResponse['widgets']['team'];
  }

  private mapFinanceWidget(
    value: unknown,
  ): AgencyDashboardFinanceWidget | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const overview = value as {
      currency?: unknown;
      period?: {
        type?: unknown;
        start?: unknown;
        end?: unknown;
      };
      cards?: Record<string, unknown>;
      counts?: Record<string, unknown>;
      status?: unknown;
    };

    const cards = overview.cards ?? {};
    const counts = overview.counts ?? {};

    return {
      currency: this.toStringValue(overview.currency),
      period: {
        type: this.toStringValue(overview.period?.type),
        start: this.toStringValue(overview.period?.start),
        end: this.toStringValue(overview.period?.end),
      },
      status: this.toStringValue(overview.status),
      metrics: {
        mrr: this.toNumber(cards.mrr),
        revenueIssued: this.toNumber(cards.revenueIssued),
        revenueReceived: this.toNumber(cards.revenueReceived),
        openReceivables: this.toNumber(cards.openReceivables),
        overdueReceivables: this.toNumber(cards.overdueReceivables),
        defaultRate: this.toNumber(cards.defaultRate),
        averageTicket: this.toNumber(cards.averageTicket),
        fixedCosts: this.toNumber(cards.fixedCosts),
        variableCosts: this.toNumber(cards.variableCosts),
        grossMargin: this.toNumber(cards.grossMargin),
        netMargin: this.toNumber(cards.netMargin),
        breakEvenPoint: this.toNumber(cards.breakEvenPoint),
        activeContracts: this.toNumber(cards.activeContracts),
      },
      counts: {
        invoices: this.toNumber(counts.invoices),
        monthInvoices: this.toNumber(counts.monthInvoices),
        bills: this.toNumber(counts.bills),
        monthBills: this.toNumber(counts.monthBills),
        recurringProfiles: this.toNumber(counts.recurringProfiles),
        activeRecurringProfiles: this.toNumber(counts.activeRecurringProfiles),
      },
    };
  }

  private mapProfitabilityWidget(
    value: unknown,
  ): AgencyDashboardProfitabilityWidget | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    return value as AgencyDashboardProfitabilityWidget;
  }

  private mapClientsWidget(
    summaryValue: unknown,
    profitabilityValue: unknown,
  ): AgencyDashboardClientsWidget | null {
    if (!summaryValue || typeof summaryValue !== 'object') {
      return null;
    }

    const summary = summaryValue as {
      total?: unknown;
      active?: unknown;
      archived?: unknown;
      byStatus?: unknown;
      byLifecycleStage?: unknown;
      byHealthStatus?: unknown;
    };

    const officialClients = this.toNumber(summary.total);

    let linkedClients = 0;
    let unlinkedFinancialClients = 0;
    let clientsWithoutProfitabilityData = 0;

    if (
      profitabilityValue &&
      typeof profitabilityValue === 'object'
    ) {
      const profitability =
        profitabilityValue as Record<string, unknown>;

      const profitabilitySummary =
        profitability.summary &&
        typeof profitability.summary === 'object'
          ? profitability.summary as Record<string, unknown>
          : {};

      const profitabilityClients = Array.isArray(
        profitability.clients,
      )
        ? profitability.clients
        : [];

      linkedClients = profitabilityClients.filter((item) => {
        if (!item || typeof item !== 'object') {
          return false;
        }

        const client = item as Record<string, unknown>;

        const metadata =
          client.metadata &&
          typeof client.metadata === 'object'
            ? client.metadata as Record<string, unknown>
            : {};

        return metadata.source === 'agency_clients';
      }).length;

      unlinkedFinancialClients =
        profitabilityClients.length - linkedClients;

      clientsWithoutProfitabilityData = this.toNumber(
        profitabilitySummary.clientsWithoutProfitabilityData,
      );
    }

    return {
      total: officialClients,
      active: this.toNumber(summary.active),
      archived: this.toNumber(summary.archived),
      byStatus: this.toNumberRecord(summary.byStatus),
      byLifecycleStage: this.toNumberRecord(
        summary.byLifecycleStage,
      ),
      byHealthStatus: this.toNumberRecord(
        summary.byHealthStatus,
      ),
      profitabilitySummary: {
        officialClients,
        linkedClients,
        unlinkedFinancialClients,
        clientsWithoutProfitabilityData,
      },
      profitability:
        profitabilityValue &&
        typeof profitabilityValue === 'object'
          ? profitabilityValue as Record<string, unknown>
          : null,
    };
  }

  private mapSalesWidget(value: unknown): AgencyDashboardSalesWidget | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const overview = value as Record<string, unknown>;

    return {
      items: this.toNumber(overview.items),
      pipelines: this.toNumber(overview.pipelines),
      opportunities: this.toNumber(overview.opportunities),
      quotes: this.toNumber(overview.quotes),
    };
  }

  private mapActivitiesWidget(
    value: unknown,
  ): AgencyDashboardActivitiesWidget | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const summary = value as Record<string, unknown>;

    const items = Array.isArray(summary.items)
      ? summary.items.map((item) => {
          const activityItem = item as Record<string, unknown>;

          return {
            id: this.toStringValue(activityItem.id),
            type: this.toStringValue(activityItem.type),
            summary: this.toStringValue(activityItem.summary),
            assignedToId:
              typeof activityItem.assignedToId === 'string'
                ? activityItem.assignedToId
                : null,
            assignedToName: null,
            dueAt:
              typeof activityItem.dueAt === 'string'
                ? activityItem.dueAt
                : null,
            overdue: Boolean(activityItem.overdue),
            href: this.toStringValue(activityItem.href),
          } satisfies AgencyDashboardActivityItem;
        })
      : [];

    return {
      total: this.toNumber(summary.total),
      byStatus: this.toNumberRecord(summary.byStatus),
      overdue: this.toNumber(summary.overdue),
      myOpen: this.toNumber(summary.myOpen),
      items,
    };
  }

  private requireValue(value: string | undefined, field: string): string {
    if (!value) {
      throw new ForbiddenException(`Missing authenticated ${field} context.`);
    }

    return value;
  }

  private resolveMarkets(
    market: 'US' | 'BR' | 'ALL' | undefined,
  ): Array<'US' | 'BR'> {
    if (market === 'US') return ['US'];
    if (market === 'BR') return ['BR'];
    return ['US', 'BR'];
  }

  private resolveErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return fallback;
  }

  private toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // Total revenue of the client portfolio (clientsProfitability.summary.revenue).
  private extractPortfolioRevenue(value: unknown): number | null {
    if (!value || typeof value !== 'object') return null;
    const summary = (value as Record<string, unknown>).summary;
    if (!summary || typeof summary !== 'object') return null;
    const revenue = (summary as Record<string, unknown>).revenue;
    const parsed = Number(revenue);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toStringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private toNumberRecord(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object') {
      return {};
    }

    return Object.entries(value).reduce<Record<string, number>>(
      (result, [key, itemValue]) => {
        result[key] = this.toNumber(itemValue);
        return result;
      },
      {},
    );
  }
}
