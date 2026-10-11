import { ClientsService } from './clients.service';
import { ClientsProfitabilityService } from './clients-profitability.service';
import { resolveContractTerm } from '../../contracts/contract-term';
const scope = { tenantId: 'tenant', workspaceId: 'workspace', userId: 'user' };
it('overview exposes backend term without modifying financial health or counters', async () => {
  const contractTerm = resolveContractTerm([], '2026-10-11');
  const profitability = {
    getClientProfitability: jest
      .fn()
      .mockResolvedValue({ profitability: { health: 'risk', revenue: 10 } }),
    getClientContractTerm: jest.fn().mockResolvedValue(contractTerm),
  };
  const service = new ClientsService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    profitability as unknown as ClientsProfitabilityService,
    {} as never,
    { findLinkedCostCenter: jest.fn().mockResolvedValue(null) } as never,
  );
  jest
    .spyOn(service, 'findOneWithProducts')
    .mockResolvedValue({ id: 'client' } as never);
  const counters = { tasks: 2 };
  jest
    .spyOn(
      service as unknown as { getCounters: () => Promise<unknown> },
      'getCounters',
    )
    .mockResolvedValue(counters);
  expect(await service.getOverview(scope, 'client')).toMatchObject({
    contractTerm: { state: 'none' },
    profitability: { health: 'risk', revenue: 10 },
    counters,
  });
  expect(profitability.getClientContractTerm).toHaveBeenCalledWith(
    scope,
    'client',
  );
});
it('portfolio includes a term object for finance-only identities and keeps health intact', async () => {
  const finance = {
    getOverview: jest.fn().mockResolvedValue({
      clients: [
        {
          id: 'finance-only',
          health: 'healthy',
          revenue: 100,
          grossProfit: 50,
          margin: 0.5,
        },
      ],
      summary: { revenue: 100, grossProfit: 50 },
      notes: [],
    }),
  };
  const query = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    distinctOn: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
  const service = new ClientsProfitabilityService(
    finance as never,
    { find: jest.fn().mockResolvedValue([]) } as never,
    { createQueryBuilder: () => query } as never,
    {
      findOne: jest.fn().mockResolvedValue({ expiringWindowDays: 45 }),
    } as never,
  );
  const result = await service.getPortfolio(scope);
  expect(result.clients[0]).toMatchObject({
    id: 'finance-only',
    health: 'healthy',
    contractTerm: { state: 'none', windowDays: 45 },
  });
});
