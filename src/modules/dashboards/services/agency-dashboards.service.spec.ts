import {
  AgencyDashboardsService,
  mapDashboardClientLifecycleProcesses,
  resolveDashboardClientHealthCounts,
} from './agency-dashboards.service';
import { AgencyDashboardPrioritiesService } from './agency-dashboard-priorities.service';

describe('AgencyDashboardsService client mapping', () => {
  it('does not turn archived clients with historical debt into client-health priorities', () => {
    expect(
      resolveDashboardClientHealthCounts(
        {
          clients: [
            { status: 'active', health: 'risk', archivedAt: null },
            { status: 'ended', health: 'critical', archivedAt: '2026-10-21' },
            { status: 'archived', health: 'critical', archivedAt: null },
          ],
        },
        {},
      ),
    ).toEqual({ risk: 1 });
  });

  it('excludes archived clients from health alerts and keeps Finance MRR', async () => {
    const portfolio = {
      summary: { revenue: 99999 },
      clients: [
        { id: 'active', status: 'active', health: 'healthy', archivedAt: null },
        {
          id: 'archived-date',
          status: 'ended',
          health: 'critical',
          archivedAt: '2026-10-21',
        },
        {
          id: 'archived-status',
          status: 'archived',
          health: 'risk',
          archivedAt: null,
        },
      ],
    };
    const service = new AgencyDashboardsService(
      {
        getContext: jest.fn().mockResolvedValue({ products: [], account: {} }),
      } as never,
      { getOverview: jest.fn().mockResolvedValue(null) } as never,
      { getSummary: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      {
        getReportsOverview: jest
          .fn()
          .mockResolvedValue({ cards: { mrr: 1100 } }),
      } as never,
      {} as never,
      {
        summary: jest
          .fn()
          .mockResolvedValue({ byHealthStatus: { critical: 2 } }),
      } as never,
      { getPortfolio: jest.fn().mockResolvedValue(portfolio) } as never,
      {} as never,
      { getSummary: jest.fn().mockResolvedValue(null) } as never,
      {
        resolveAccess: () => ({
          canViewDashboard: true,
          canViewFinance: true,
          canViewPortfolio: true,
        }),
        resolvePreset: () => 'executive',
      } as never,
      new AgencyDashboardPrioritiesService(),
    );
    const result = await service.getOverview(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: 'owner',
      },
      {},
    );
    expect(result.partialFailures).toEqual([]);
    expect(result.widgets.finance?.metrics.mrr).toBe(1100);
    expect(result.widgets.clients?.byHealthStatus).toEqual({ healthy: 1 });
    expect(result.priorities).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'client_health_critical' }),
      ]),
    );
  });

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
