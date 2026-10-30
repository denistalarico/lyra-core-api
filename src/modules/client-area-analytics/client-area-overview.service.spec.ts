import type { ClientAreaContext } from '../client-area/client-area.types';
import { ClientAreaSourcesRegistry } from './client-area-sources.registry';
import { ClientAreaOverviewService } from './client-area-overview.service';
const context = {
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: 'c',
  companyContextId: 'a',
  userId: 'u',
  role: 'client_member',
  accountRole: 'client_member',
  memberAccess: Object.fromEntries(
    [
      'overview',
      'agency_projects',
      'agency_billing',
      'approvals',
      'social_planner',
      'social_campaigns',
      'leadflow_inbox',
      'leadflow_crm',
      'leadflow_appointments',
    ].map((key) => [key, { available: true, level: 'viewer' }]),
  ),
} as ClientAreaContext;
describe('CA13 Overview source isolation', () => {
  it('keeps healthy slices when one source fails and never calls Billing for a member', async () => {
    const registry = new ClientAreaSourcesRegistry();
    let billing = 0;
    for (const key of [
      'agency.projects',
      'agency.tasks',
      'agency.invoices',
      'agency.contract',
      'social.approvals',
      'social.contents',
      'social.campaign',
      'leadflow.inbox',
      'leadflow.leads',
      'leadflow.appointments',
      'leadflow.kpis',
    ])
      registry.register({
        key,
        modules: [],
        ownerOnly: key === 'agency.invoices' || key === 'agency.contract',
        read: (input) => {
          expect(input.scope!.companyContextId).toBe('a');
          if (key === 'agency.invoices') billing++;
          return key === 'social.contents'
            ? Promise.reject(new Error('secret stack and token'))
            : Promise.resolve({ title: key, private: undefined });
        },
      });
    const response = await new ClientAreaOverviewService(registry).get(context);
    expect(response.slices['agency.projects'].status).toBe('available');
    expect(response.slices['social.contents']).toEqual({
      status: 'unavailable',
      reason: 'source_failed',
    });
    expect(response.partialFailures).toEqual([
      { source: 'social.contents', reason: 'source_failed' },
    ]);
    expect(billing).toBe(0);
    expect(JSON.stringify(response)).not.toContain('secret');
  });
  it('fails closed for missing source wiring and unavailable origin modules', async () => {
    const registry = new ClientAreaSourcesRegistry();
    let reads = 0;
    registry.register({
      key: 'agency.projects',
      modules: ['agency_projects'],
      read: () => {
        reads++;
        return Promise.resolve([]);
      },
    });
    const response = await new ClientAreaOverviewService(registry).get({
      ...context,
      memberAccess: {
        ...context.memberAccess!,
        agency_projects: { available: false, level: null },
      },
    });
    expect(reads).toBe(0);
    expect(response.slices['agency.projects']).toEqual({
      status: 'unavailable',
      reason: 'module_unavailable',
    });
    expect(response.slices['agency.tasks'].status).toBe('unavailable');
  });
});
