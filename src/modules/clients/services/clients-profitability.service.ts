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
    const enrichedClients = financeClients.map((client) =>
      this.enrichClientItem(client, clientsById.get(client.id) ?? null),
    );

    const clientsWithoutFinance = clients
      .filter((client) => !financeClientIds.has(client.id))
      .map((client) => this.buildEmptyClientItem(client));

    return {
      status: financeOverview.status,
      module: 'agency-clients',
      area: 'profitability',
      currency: financeOverview.currency,
      period: financeOverview.period,
      rules: financeOverview.rules,
      summary: {
        ...financeOverview.summary,
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
        profitability: agencyClient ? this.buildEmptyProfitability() : null,
        projects: [],
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
      profitability: this.extractProfitabilityMetrics(detail.client),
      projects: (detail.projects ?? []).map((project: Record<string, any>) => ({
        ...project,
        client: agencyClient ? this.toClientSnapshot(agencyClient) : null,
      })),
      notes: [
        ...(detail.notes ?? []),
        'Client identity and lifecycle data are enriched from agency_clients.',
      ],
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
  ) {
    const metrics = this.extractProfitabilityMetrics(item);

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

  private buildEmptyClientItem(client: AgencyClient) {
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
      ...this.buildEmptyProfitability(),
    };
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
