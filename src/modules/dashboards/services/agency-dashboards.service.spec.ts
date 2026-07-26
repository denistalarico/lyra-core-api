import {
  mapDashboardClientLifecycleProcesses,
  resolveDashboardClientHealthCounts,
} from './agency-dashboards.service';

describe('AgencyDashboardsService client mapping', () => {
  it('uses the profitability health shown by Clients instead of stale registry health', () => {
    const result = resolveDashboardClientHealthCounts(
      {
        clients: [
          {
            id: 'client-1',
            status: 'active',
            health: 'healthy',
          },
          {
            id: 'client-2',
            status: 'active',
            health: 'no_revenue',
          },
          {
            id: 'finance-only',
            status: null,
            health: 'unknown',
          },
        ],
      },
      { unknown: 2 },
    );

    expect(result).toEqual({
      healthy: 1,
      no_revenue: 1,
    });
    expect(result.unknown).toBeUndefined();
  });

  it('maps active client lifecycle processes into dashboard links', () => {
    const result = mapDashboardClientLifecycleProcesses([
      {
        id: 'process-1',
        clientId: 'client-1',
        clientName: 'Acme',
        processType: 'offboarding',
        status: 'in_progress',
        startedAt: '2026-07-26T12:00:00.000Z',
        href: '/clients/client-1?tab=lifecycle&process=offboarding',
      },
    ]);

    expect(result).toEqual([
      {
        id: 'process-1',
        clientId: 'client-1',
        clientName: 'Acme',
        processType: 'offboarding',
        status: 'in_progress',
        startedAt: '2026-07-26T12:00:00.000Z',
        href: '/clients/client-1?tab=lifecycle&process=offboarding',
      },
    ]);
  });
});
