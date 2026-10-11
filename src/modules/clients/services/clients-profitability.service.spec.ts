import { IsNull, Not } from 'typeorm';
import { AgencyClientStatus } from '../enums';
import { ClientsProfitabilityService } from './clients-profitability.service';

const CONTEXT = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
};

describe('ClientsProfitabilityService', () => {
  it.each([
    {
      invoiced: 4897,
      recurring: 0,
      revenue: 4897,
      expected: 4897,
      supplement: 0,
    },
    { invoiced: 0, recurring: 0, revenue: 0, expected: 4897, supplement: 4897 },
    {
      invoiced: 2000,
      recurring: 0,
      revenue: 2000,
      expected: 4897,
      supplement: 2897,
    },
    {
      invoiced: 5647,
      recurring: 0,
      revenue: 5647,
      expected: 5647,
      supplement: 0,
    },
    {
      invoiced: 0,
      recurring: 3000,
      revenue: 3000,
      expected: 3000,
      supplement: 0,
    },
  ])(
    'does not add the contract again to recognized monthly revenue: $revenue',
    async ({ invoiced, recurring, revenue, expected, supplement }) => {
      const metrics = {
        id: 'client-1',
        revenue,
        invoicedRevenue: invoiced,
        recurringRevenue: recurring,
        directCosts: 100,
        laborCost: 200,
        aiCost: { includedInGrossProfit: 50 },
        grossProfit: revenue - 350,
        margin: revenue > 0 ? (revenue - 350) / revenue : 0,
        health: 'healthy',
        metadata: {},
      };
      const finance = {
        getOverview: jest.fn().mockResolvedValue({
          status: 'ok',
          clients: [metrics],
          summary: { revenue, grossProfit: revenue - 350 },
          notes: [],
        }),
        getClientDetail: jest.fn().mockResolvedValue({
          status: 'ok',
          client: metrics,
          projects: [],
          notes: [],
        }),
      };
      const client = {
        id: 'client-1',
        metadata: { billing: { monthlyFee: 4897, active: true } },
      };
      const repository = {
        find: jest.fn().mockResolvedValue([client]),
        findOne: jest.fn().mockResolvedValue(client),
      };
      const service = new ClientsProfitabilityService(
        finance as never,
        repository as never,
      );
      const portfolio = await service.getPortfolio(CONTEXT);
      const detail = await service.getClientProfitability(CONTEXT, client.id);
      expect(portfolio.clients[0]).toMatchObject({
        revenue: expected,
        grossProfit: expected - 350,
        invoicedRevenue: invoiced,
      });
      expect(detail.profitability).toMatchObject({
        revenue: expected,
        grossProfit: expected - 350,
      });
      expect(portfolio.summary).toMatchObject({
        revenue: expected,
        grossProfit: expected - 350,
      });
      expect(portfolio.clients[0]).toMatchObject({
        recurringRevenue: recurring + supplement,
      });
    },
  );

  it('requests monthly aggregation only for non-archived clients in the authorized workspace', async () => {
    const finance = {
      getPortfolioMonthlyProfitability: jest
        .fn()
        .mockResolvedValue({ status: 'ok', series: [] }),
    };
    const repository = {
      find: jest.fn().mockResolvedValue([{ id: 'active-client' }]),
    };
    const service = new ClientsProfitabilityService(
      finance as never,
      repository as never,
    );
    const result = await service.getPortfolioMonthlyProfitability(CONTEXT, {
      months: 6,
    });
    expect(repository.find).toHaveBeenCalledWith({
      where: {
        tenantId: CONTEXT.tenantId,
        workspaceId: CONTEXT.workspaceId,
        archivedAt: IsNull(),
        status: Not(AgencyClientStatus.Archived),
      },
      select: { id: true },
    });
    expect(finance.getPortfolioMonthlyProfitability).toHaveBeenCalledWith(
      CONTEXT,
      ['active-client'],
      { months: 6 },
    );
    expect(result.module).toBe('agency-clients');
  });

  it('keeps delinquency as a risk after applying a contracted monthly fee', async () => {
    const financeProfitabilityService = {
      getClientDetail: jest.fn().mockResolvedValue({
        status: 'ok',
        currency: 'BRL',
        period: { type: 'monthly', start: '2026-10-01', end: '2026-10-31' },
        rules: {
          healthyMarginThreshold: 0.4,
          attentionMarginThreshold: 0.2,
          riskMarginThreshold: 0,
        },
        client: {
          revenue: 0,
          recurringRevenue: 0,
          invoicedRevenue: 0,
          directCosts: 0,
          laborMinutes: 0,
          laborHours: 0,
          laborCost: 0,
          grossProfit: 0,
          margin: 0,
          health: 'no_revenue',
          delinquency: {
            overdueInvoiceCount: 2,
            overdueBalance: 2000,
            oldestOverdueDays: 45,
          },
          tasks: 0,
        },
        projects: [],
        hoursByTaskType: [],
        notes: [],
      }),
    };
    const clientsRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'client-1',
        metadata: { billing: { monthlyFee: 1000 } },
      }),
    };
    const service = new ClientsProfitabilityService(
      financeProfitabilityService as never,
      clientsRepository as never,
    );

    const result = await service.getClientProfitability(CONTEXT, 'client-1');

    expect(result.profitability).toMatchObject({
      revenue: 1000,
      health: 'risk',
      delinquency: {
        overdueInvoiceCount: 2,
        overdueBalance: 2000,
        oldestOverdueDays: 45,
      },
    });
  });
});
