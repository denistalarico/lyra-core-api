import { IsNull, Not } from 'typeorm';
import { AgencyClientStatus } from '../enums';
import { ClientsProfitabilityService } from './clients-profitability.service';

const CONTEXT = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
};

describe('ClientsProfitabilityService', () => {
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
