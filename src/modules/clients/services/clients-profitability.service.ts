import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FinanceProfitabilityService } from '../../finance/services/finance-profitability.service';
import { FinanceRequestContext } from '../../finance/services/finance-context';
import { AgencyClient } from '../entities';
import { AgencyClientHealthStatus } from '../enums';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
};

const AGENCY_CONNECTION = 'agency';

@Injectable()
export class ClientsProfitabilityService {
  constructor(
    private readonly financeProfitabilityService: FinanceProfitabilityService,
    @InjectRepository(AgencyClient, AGENCY_CONNECTION)
    private readonly clientsRepository: Repository<AgencyClient>,
  ) {}

  async getPortfolio(ctx: RequestContext) {
    const financeOverview = await this.financeProfitabilityService.getOverview(
      this.toFinanceContext(ctx),
    );

    const clients = await this.clientsRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: {
        displayName: 'ASC',
      },
    });

    const clientsById = new Map(clients.map((client) => [client.id, client]));
    const financeClients = financeOverview.clients ?? [];
    const financeClientIds = new Set(financeClients.map((client) => client.id));
    const rules = financeOverview.rules;
    const enrichedClients = financeClients.map((client) =>
      this.enrichClientItem(client, clientsById.get(client.id) ?? null, rules),
    );

    const clientsWithoutFinance = clients
      .filter((client) => !financeClientIds.has(client.id))
      .map((client) => this.buildEmptyClientItem(client, rules));

    // Contracted monthly fees configured on agency_clients.metadata.billing are
    // injected into each client's revenue above; reflect them in the portfolio
    // totals so the summary KPIs stay consistent with the per-client rows.
    const injectedFees = [...enrichedClients, ...clientsWithoutFinance].reduce(
      (sum, client) =>
        sum +
        this.toNumber(
          (client as Record<string, any>).metadata?.contractedMonthlyFee,
        ),
      0,
    );

    const summaryRevenue = this.roundMoney(
      this.toNumber(financeOverview.summary?.revenue) + injectedFees,
    );
    const summaryGrossProfit = this.roundMoney(
      this.toNumber(financeOverview.summary?.grossProfit) + injectedFees,
    );

    return {
      status: financeOverview.status,
      module: 'agency-clients',
      area: 'profitability',
      currency: financeOverview.currency,
      period: financeOverview.period,
      rules: financeOverview.rules,
      summary: {
        ...financeOverview.summary,
        revenue: summaryRevenue,
        grossProfit: summaryGrossProfit,
        margin:
          summaryRevenue > 0
            ? this.roundRate(summaryGrossProfit / summaryRevenue)
            : this.toNumber(financeOverview.summary?.margin),
        clients: clients.length,
        clientsWithProfitabilityData: financeClients.length,
        clientsWithoutProfitabilityData: clientsWithoutFinance.length,
      },
      clients: [...enrichedClients, ...clientsWithoutFinance],
      notes: [
        ...financeOverview.notes,
        'Client identity and lifecycle data are enriched from agency_clients.',
      ],
    };
  }

  async getClientProfitability(ctx: RequestContext, clientId: string) {
    const [financeDetail, agencyClient] = await Promise.all([
      this.financeProfitabilityService.getClientDetail(
        this.toFinanceContext(ctx),
        clientId,
      ),
      this.clientsRepository.findOne({
        where: {
          id: clientId,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      }),
    ]);
    const detail = financeDetail as Record<string, any>;

    if (detail.status !== 'ok') {
      return {
        status: agencyClient ? 'ok' : detail.status,
        module: 'agency-clients',
        area: 'profitability',
        type: 'client',
        id: clientId,
        currency: detail.currency ?? null,
        period: detail.period ?? null,
        rules: detail.rules ?? null,
        client: agencyClient ? this.toClientSnapshot(agencyClient) : null,
        profitability: agencyClient
          ? this.applyContractedFee(
              this.buildEmptyProfitability(),
              agencyClient,
              detail.rules,
            )
          : null,
        projects: [],
        hoursByTaskType: [],
        notes: [
          ...(detail.notes ?? []),
          'No profitability data was found for this client in Finance.',
        ],
      };
    }

    return {
      status: detail.status,
      module: 'agency-clients',
      area: 'profitability',
      type: 'client',
      id: clientId,
      currency: detail.currency,
      period: detail.period,
      rules: detail.rules,
      client: agencyClient ? this.toClientSnapshot(agencyClient) : null,
      profitability: this.applyContractedFee(
        this.extractProfitabilityMetrics(detail.client),
        agencyClient,
        detail.rules,
      ),
      projects: (detail.projects ?? []).map((project: Record<string, any>) => ({
        ...project,
        client: agencyClient ? this.toClientSnapshot(agencyClient) : null,
      })),
      hoursByTaskType: detail.hoursByTaskType ?? [],
      notes: [
        ...(detail.notes ?? []),
        'Client identity and lifecycle data are enriched from agency_clients.',
      ],
    };
  }

  async getClientMonthlyProfitability(
    ctx: RequestContext,
    clientId: string,
    options: { startMonth?: string; endMonth?: string; months?: number } = {},
  ) {
    const result =
      await this.financeProfitabilityService.getClientMonthlyProfitability(
        this.toFinanceContext(ctx),
        clientId,
        options,
      );

    return {
      ...result,
      module: 'agency-clients',
    };
  }

  private toFinanceContext(ctx: RequestContext): FinanceRequestContext {
    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
    };
  }

  private enrichClientItem(
    item: Record<string, any>,
    client: AgencyClient | null,
    rules?: Record<string, any> | null,
  ) {
    const metrics = this.applyContractedFee(
      this.extractProfitabilityMetrics(item),
      client,
      rules,
    );

    if (!client) {
      return {
        id: item.id,
        clientId: item.clientId ?? item.id,
        displayName: item.name ?? null,
        legalName: null,
        status: null,
        lifecycleStage: null,
        healthStatus: item.health ?? AgencyClientHealthStatus.Unknown,
        segment: null,
        accountOwnerId: null,
        managedTenantId: null,
        ...metrics,
      };
    }

    return {
      id: client.id,
      clientId: client.id,
      displayName: client.displayName,
      legalName: client.legalName,
      status: client.status,
      lifecycleStage: client.lifecycleStage,
      healthStatus: client.healthStatus,
      segment: client.segment,
      accountOwnerId: client.accountOwnerId,
      managedTenantId: client.managedTenantId,
      ...metrics,
    };
  }

  private buildEmptyClientItem(
    client: AgencyClient,
    rules?: Record<string, any> | null,
  ) {
    return {
      id: client.id,
      clientId: client.id,
      displayName: client.displayName,
      legalName: client.legalName,
      status: client.status,
      lifecycleStage: client.lifecycleStage,
      healthStatus: client.healthStatus,
      segment: client.segment,
      accountOwnerId: client.accountOwnerId,
      managedTenantId: client.managedTenantId,
      ...this.applyContractedFee(
        this.buildEmptyProfitability(),
        client,
        rules,
      ),
    };
  }

  // ── Contracted monthly fee (item: payment data without a signed contract) ──

  private readMonthlyFee(client: AgencyClient | null): number {
    const billing = (client?.metadata as Record<string, any> | null)?.billing;
    if (!billing || typeof billing !== 'object') return 0;
    if (billing.active === false) return 0;

    const value = this.toNumber(
      billing.monthlyFee ?? billing.monthlyValue ?? billing.amount,
    );
    return value > 0 ? this.roundMoney(value) : 0;
  }

  // Adds the client's contracted monthly fee to its revenue/recurring revenue
  // and recomputes profit/margin/health. The fee is only applied when the
  // client has no Finance recurring revenue, so it acts as a fallback and never
  // double-counts a real recurring profile.
  private applyContractedFee(
    metrics: Record<string, any>,
    client: AgencyClient | null,
    rules?: Record<string, any> | null,
  ): Record<string, any> {
    const fee = this.readMonthlyFee(client);
    if (fee <= 0) return metrics;

    const baseRecurring = this.toNumber(metrics.recurringRevenue);
    const appliedFee = baseRecurring > 0 ? 0 : fee;
    if (appliedFee <= 0) return metrics;

    const revenue = this.toNumber(metrics.revenue) + appliedFee;
    const recurringRevenue = baseRecurring + appliedFee;
    const directCosts = this.toNumber(metrics.directCosts);
    const laborCost = this.toNumber(metrics.laborCost);
    const grossProfit = revenue - directCosts - laborCost;
    const margin = revenue > 0 ? grossProfit / revenue : 0;

    return {
      ...metrics,
      revenue: this.roundMoney(revenue),
      recurringRevenue: this.roundMoney(recurringRevenue),
      grossProfit: this.roundMoney(grossProfit),
      margin: this.roundRate(margin),
      health: this.resolveHealth(margin, revenue, grossProfit, rules),
      metadata: {
        ...(metrics.metadata ?? {}),
        contractedMonthlyFee: this.roundMoney(appliedFee),
      },
    };
  }

  private resolveHealth(
    margin: number,
    revenue: number,
    grossProfit: number,
    rules?: Record<string, any> | null,
  ): AgencyClientHealthStatus {
    if (revenue <= 0 && grossProfit < 0) return AgencyClientHealthStatus.Loss;
    if (revenue <= 0) return AgencyClientHealthStatus.NoRevenue;
    if (grossProfit < 0) return AgencyClientHealthStatus.Loss;

    const healthy = this.toNumber(rules?.healthyMarginThreshold ?? 0.4);
    const attention = this.toNumber(rules?.attentionMarginThreshold ?? 0.2);
    const risk = this.toNumber(rules?.riskMarginThreshold ?? 0);

    if (margin >= healthy) return AgencyClientHealthStatus.Healthy;
    if (margin >= attention) return AgencyClientHealthStatus.Attention;
    if (margin >= risk) return AgencyClientHealthStatus.Risk;
    return AgencyClientHealthStatus.Loss;
  }

  private toNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private roundRate(value: number): number {
    return Math.round(value * 10000) / 10000;
  }

  private extractProfitabilityMetrics(item: Record<string, any>) {
    return {
      revenue: item.revenue,
      recurringRevenue: item.recurringRevenue,
      invoicedRevenue: item.invoicedRevenue,
      directCosts: item.directCosts,
      laborMinutes: item.laborMinutes,
      laborHours: item.laborHours,
      laborCost: item.laborCost,
      grossProfit: item.grossProfit,
      margin: item.margin,
      health: item.health,
      tasks: item.tasks,
      hoursWithoutCost: item.hoursWithoutCost ?? 0,
      membersMissingCost: item.membersMissingCost ?? [],
      metadata: item.metadata ?? null,
    };
  }

  private buildEmptyProfitability() {
    return {
      revenue: 0,
      recurringRevenue: 0,
      invoicedRevenue: 0,
      directCosts: 0,
      laborMinutes: 0,
      laborHours: 0,
      laborCost: 0,
      grossProfit: 0,
      margin: 0,
      health: AgencyClientHealthStatus.NoRevenue,
      tasks: 0,
      hoursWithoutCost: 0,
      membersMissingCost: [],
      metadata: { projects: 0, source: 'agency_clients' },
    };
  }

  private toClientSnapshot(client: AgencyClient) {
    return {
      id: client.id,
      contactId: client.contactId,
      displayName: client.displayName,
      legalName: client.legalName,
      status: client.status,
      lifecycleStage: client.lifecycleStage,
      healthStatus: client.healthStatus,
      segment: client.segment,
      accountOwnerId: client.accountOwnerId,
      managedTenantId: client.managedTenantId,
      startDate: client.startDate,
      endDate: client.endDate,
      archivedAt: client.archivedAt,
    };
  }
}
