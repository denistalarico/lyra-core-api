import type { ClientAreaSelfContext } from '../../client-area/client-area.types';
import type { AgencyDashboardsService } from '../services/agency-dashboards.service';
import type { AgencyDashboardOverviewResponse } from '../types';
import { ClientAreaSelfOverviewService } from './client-area-self-overview.service';

/**
 * PD4 §39 — the projection's own tests.
 *
 * The canonical dashboard is stubbed rather than exercised: what must be
 * proven here is that the projection copies the right fields, omits every
 * internal one, keeps a failed slice distinguishable from a zero one, and
 * issues exactly one call to the canonical source. Whether the dashboard's own
 * numbers are right is that service's test, not this one's.
 */

const SELF_CONTEXT: ClientAreaSelfContext = {
  surface: 'client_area',
  kind: 'agency_self',
  userId: 'user-1',
  tenantId: 'tenant-1',
  sessionId: 'session-1',
  selfAccessId: 'self-access-1',
  workspaceId: 'workspace-1',
  agencyDisplayName: 'Talarico Labs',
  role: 'client_admin',
  agencyRole: 'owner',
  permissions: new Set(['client_area.self.overview.view']),
  modules: { approvals: false, conversations: false },
};

function dashboard(
  overrides: Partial<AgencyDashboardOverviewResponse> = {},
): AgencyDashboardOverviewResponse {
  return {
    generatedAt: '2026-10-03T00:00:00.000Z',
    product: {
      key: 'agency',
      moduleKey: 'agency.dashboard',
      entitlementStatus: 'active',
    },
    context: {
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      accountType: 'agency',
      accountStatus: 'active',
      accountDisplayName: 'Talarico Labs',
      managedTenantId: null,
      agencyClientId: null,
    },
    user: { id: 'user-1', role: 'owner', preset: 'executive' },
    access: {
      canViewDashboard: true,
      canViewFinance: true,
      canViewProfitability: true,
      canViewCommercial: true,
      canViewTeam: true,
      canViewPortfolio: true,
      canViewCrossProductSignals: true,
      canManageLayout: true,
    },
    greeting: { attentionCount: 0, messageKey: 'dashboard.stable' },
    priorities: [],
    widgets: {
      projects: null,
      finance: null,
      profitability: null,
      clients: null,
      sales: null,
      activities: null,
      calendar: null,
      team: null,
    },
    opportunities: {
      trends: {
        status: 'pending_integration',
        markets: ['US', 'BR'],
        items: [],
      },
      dates: {
        status: 'pending_integration',
        markets: ['US', 'BR'],
        items: [],
      },
      dailyTip: { status: 'pending_integration', item: null },
    },
    partialFailures: [],
    ...overrides,
  };
}

function financeWidget() {
  return {
    currency: 'BRL',
    period: { type: 'monthly', start: '2026-10-01', end: '2026-10-31' },
    status: 'ok',
    metrics: {
      mrr: 50000,
      revenueIssued: 120000,
      revenueReceived: 90000,
      costsPaid: 45000,
      openReceivables: 30000,
      overdueReceivables: 8000,
      defaultRate: 0.1,
      averageTicket: 12000,
      fixedCosts: 40000,
      variableCosts: 20000,
      grossMargin: 0.83,
      netMargin: 0.5,
      breakEvenPoint: 48000,
      activeContracts: 9,
    },
    counts: {
      invoices: 22,
      monthInvoices: 10,
      bills: 41,
      monthBills: 12,
      recurringProfiles: 4,
      activeRecurringProfiles: 3,
    },
  };
}

function build(overview: AgencyDashboardOverviewResponse | Error) {
  const getOverview = jest.fn(() =>
    overview instanceof Error
      ? Promise.reject(overview)
      : Promise.resolve(overview),
  );
  const service = new ClientAreaSelfOverviewService({
    getOverview,
  } as unknown as AgencyDashboardsService);
  return { service, getOverview };
}

describe('ClientAreaSelfOverviewService', () => {
  it('derives the scope from the self context and asks the canonical source once', async () => {
    const { service, getOverview } = build(dashboard());

    await service.getOverview(SELF_CONTEXT);

    // §25 — one call to one aggregate, not a query per card.
    expect(getOverview).toHaveBeenCalledTimes(1);
    expect(getOverview).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: 'owner',
      },
      {},
    );
  });

  it('projects finance using the module own cost and result definitions', async () => {
    const { service } = build(
      dashboard({
        widgets: { ...dashboard().widgets, finance: financeWidget() },
      }),
    );

    const result = await service.getOverview(SELF_CONTEXT);

    expect(result.finance).toEqual({
      status: 'ok',
      currency: 'BRL',
      revenueIssued: 120000,
      revenueReceived: 90000,
      // fixedCosts + variableCosts, as finance.service.ts defines totalCosts.
      expenses: 60000,
      result: 60000,
      openReceivables: 30000,
      overdueReceivables: 8000,
    });
    expect(result.period).toEqual({
      type: 'current_month',
      start: '2026-10-01',
      end: '2026-10-31',
    });
  });

  it('does not project ratios or document counts that need their own explanation', async () => {
    const { service } = build(
      dashboard({
        widgets: { ...dashboard().widgets, finance: financeWidget() },
      }),
    );

    const finance = (await service.getOverview(SELF_CONTEXT)).finance as Record<
      string,
      unknown
    >;

    for (const key of [
      'mrr',
      'defaultRate',
      'averageTicket',
      'breakEvenPoint',
      'grossMargin',
      'netMargin',
      'activeContracts',
      'counts',
    ]) {
      expect(finance[key]).toBeUndefined();
    }
  });

  it('copies the canonical margin and health instead of recomputing them', async () => {
    const { service } = build(
      dashboard({
        widgets: {
          ...dashboard().widgets,
          profitability: {
            currency: 'BRL',
            period: { type: 'monthly', start: '2026-10-01', end: '2026-10-31' },
            summary: {
              revenue: 100000,
              directCosts: 25000,
              laborCost: 15000,
              grossProfit: 60000,
              margin: 0.6,
              health: 'healthy',
            },
          },
        },
      }),
    );

    expect((await service.getOverview(SELF_CONTEXT)).profitability).toEqual({
      status: 'ok',
      currency: 'BRL',
      revenue: 100000,
      cost: 40000,
      grossProfit: 60000,
      margin: 0.6,
      health: 'healthy',
    });
  });

  it('projects operations as counts and never the attention items', async () => {
    const { service } = build(
      dashboard({
        widgets: {
          ...dashboard().widgets,
          projects: {
            generatedAt: '2026-10-03T00:00:00.000Z',
            scope: 'workspace',
            projects: {
              active: 7,
              overdue: 2,
              attentionItems: [{ id: 'p-1' }],
            },
            tasks: {
              open: 31,
              overdue: 5,
              dueToday: 3,
              attentionItems: [
                {
                  id: 'task-1',
                  title: 'Private task',
                  blockedReason: 'waiting on legal',
                  visibility: 'private',
                  assigneeId: 'user-9',
                },
              ],
            },
            personalTasks: { attentionItems: [] },
            subtasks: { attentionItems: [] },
            personalSubtasks: { attentionItems: [] },
          } as never,
          activities: {
            total: 17,
            byStatus: { open: 4, in_progress: 3, done: 9, cancelled: 1 },
            overdue: 2,
            myOpen: 1,
            items: [{ id: 'a-1', summary: 'Call the client' }],
          } as never,
        },
      }),
    );

    const result = await service.getOverview(SELF_CONTEXT);

    expect(result.operations).toEqual({
      status: 'ok',
      activeProjects: 7,
      overdueProjects: 2,
      openTasks: 31,
      overdueTasks: 5,
      dueTodayTasks: 3,
      // open + in_progress; done and cancelled are terminal.
      openActivities: 7,
      overdueActivities: 2,
    });

    // §11/§21 — no operational detail reaches the surface.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('Private task');
    expect(serialized).not.toContain('waiting on legal');
    expect(serialized).not.toContain('user-9');
    expect(serialized).not.toContain('Call the client');
  });

  it('counts lifecycle processes without exposing which clients they belong to', async () => {
    const { service } = build(
      dashboard({
        widgets: {
          ...dashboard().widgets,
          clients: {
            total: 10,
            active: 9,
            archived: 1,
            byStatus: { active: 9 },
            byLifecycleStage: {},
            byHealthStatus: { healthy: 4, critical: 1 },
            lifecycleProcesses: [
              {
                id: 'process-1',
                clientId: 'client-77',
                clientName: 'Acme',
                processType: 'onboarding',
                status: 'in_progress',
                startedAt: null,
                href: '/clients/client-77?tab=lifecycle',
              },
              {
                id: 'process-2',
                clientId: 'client-88',
                clientName: 'Globex',
                processType: 'offboarding',
                status: 'in_progress',
                startedAt: null,
                href: '/clients/client-88?tab=lifecycle',
              },
            ],
            profitabilitySummary: {
              officialClients: 10,
              linkedClients: 8,
              unlinkedFinancialClients: 2,
              clientsWithoutProfitabilityData: 1,
            },
            profitability: null,
          },
        },
      }),
    );

    const result = await service.getOverview(SELF_CONTEXT);

    expect(result.clients).toEqual({
      status: 'ok',
      total: 10,
      active: 9,
      archived: 1,
      onboarding: 1,
      offboarding: 1,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('client-77');
    expect(serialized).not.toContain('process-1');
    expect(serialized).not.toContain('/clients/');
  });

  it('keeps only aggregate alerts, in the canonical order, with no ids or hrefs', async () => {
    const { service } = build(
      dashboard({
        priorities: [
          {
            id: 'finance-overdue-receivables',
            type: 'overdue_receivables',
            severity: 'critical',
            title: 'Existem recebimentos vencidos',
            description: 'BRL 8000.00 em aberto e vencido.',
            sourceModule: 'finance',
            href: '/finance/invoices?status=overdue',
            entityId: 'finance-overdue-receivables',
            dueAt: null,
            score: 150,
          },
          {
            id: 'project-overdue:proj-55',
            type: 'overdue_project',
            severity: 'critical',
            title: 'Projeto atrasado',
            description: 'Rebranding Acme',
            sourceModule: 'projects',
            href: '/projects/proj-55',
            entityId: 'proj-55',
            dueAt: '2026-09-01',
            score: 140,
          },
          {
            id: 'clients-attention-health',
            type: 'client_health_attention',
            severity: 'high',
            title: 'Clientes exigem atenção',
            description: '2 cliente(s) estão em nível de atenção.',
            sourceModule: 'clients',
            href: '/clients?health=attention',
            entityId: 'clients-attention-health',
            dueAt: null,
            score: 100,
          },
        ],
      }),
    );

    const result = await service.getOverview(SELF_CONTEXT);

    expect(result.alerts).toEqual({
      status: 'ok',
      items: [
        {
          key: 'finance-overdue-receivables',
          severity: 'critical',
          title: 'Existem recebimentos vencidos',
          description: 'BRL 8000.00 em aberto e vencido.',
          source: 'finance',
        },
        {
          key: 'clients-attention-health',
          severity: 'high',
          title: 'Clientes exigem atenção',
          description: '2 cliente(s) estão em nível de atenção.',
          source: 'clients',
        },
      ],
    });

    // §21/§37 — the project alert carried a real entity id and an Agency route.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('proj-55');
    expect(serialized).not.toContain('/projects/');
    expect(serialized).not.toContain('/finance/');
    expect(serialized).not.toContain('href');
  });

  it('distinguishes a failed slice from an unavailable one, and neither is a zero', async () => {
    const { service } = build(
      dashboard({
        // Finance threw; profitability was never attempted for this role.
        partialFailures: [{ source: 'finance', message: 'connection reset' }],
      }),
    );

    const result = await service.getOverview(SELF_CONTEXT);

    expect(result.finance).toEqual({
      status: 'unavailable',
      reason: 'source_failed',
    });
    expect(result.profitability).toEqual({
      status: 'unavailable',
      reason: 'not_available',
    });
    // §7 — no zero stands in for missing data.
    expect(JSON.stringify(result)).not.toContain('"revenueIssued":0');
    // §44 — the internal failure message never reaches the client.
    expect(JSON.stringify(result)).not.toContain('connection reset');
  });

  it('survives one failing slice without losing the others', async () => {
    const { service } = build(
      dashboard({
        widgets: { ...dashboard().widgets, finance: financeWidget() },
        partialFailures: [{ source: 'clients', message: 'timeout' }],
      }),
    );

    const result = await service.getOverview(SELF_CONTEXT);

    expect(result.finance.status).toBe('ok');
    expect(result.clients).toEqual({
      status: 'unavailable',
      reason: 'source_failed',
    });
  });

  it('renders an honest empty surface when the canonical source is gone entirely', async () => {
    const { service } = build(new Error('Agency product is not available'));

    const result = await service.getOverview(SELF_CONTEXT);

    expect(result.agencyDisplayName).toBe('Talarico Labs');
    for (const slice of [
      result.finance,
      result.profitability,
      result.operations,
      result.clients,
      result.alerts,
    ]) {
      expect(slice).toEqual({ status: 'unavailable', reason: 'source_failed' });
    }
    expect(JSON.stringify(result)).not.toContain(
      'Agency product is not available',
    );
  });

  it('never serializes a tenant, workspace, user, company or access id', async () => {
    const { service } = build(
      dashboard({
        widgets: { ...dashboard().widgets, finance: financeWidget() },
      }),
    );

    const serialized = JSON.stringify(await service.getOverview(SELF_CONTEXT));

    // §21 — asserted against the real values the self context carries.
    for (const forbidden of [
      'tenant-1',
      'workspace-1',
      'user-1',
      'session-1',
      'self-access-1',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    for (const key of [
      'tenantId',
      'workspaceId',
      'userId',
      'sessionId',
      'selfAccessId',
      'agencyClientId',
      'companyContextId',
      'managedTenantId',
      'agencyRole',
      'permissions',
      'membershipId',
    ]) {
      expect(serialized).not.toContain(key);
    }
  });

  it('carries no company context anywhere in the projection', async () => {
    const { service } = build(
      dashboard({
        widgets: { ...dashboard().widgets, finance: financeWidget() },
      }),
    );

    const result = await service.getOverview(SELF_CONTEXT);

    // §20 — the self scope is tenant/workspace only; nothing company-shaped
    // exists to be forged or leaked.
    expect(Object.keys(result).sort()).toEqual([
      'agencyDisplayName',
      'alerts',
      'clients',
      'finance',
      'generatedAt',
      'operations',
      'period',
      'profitability',
    ]);
  });
});
