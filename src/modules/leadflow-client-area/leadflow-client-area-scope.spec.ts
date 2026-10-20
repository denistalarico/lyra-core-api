import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { ClientAreaBridgeRegistry } from '../../common/client-area-bridge/client-area-bridge.registry';
import type { ClientAreaContext } from '../client-area/client-area.types';
import { LeadFlowClientAreaScopeService } from './leadflow-client-area-scope.service';

const tenantId = randomUUID(),
  workspaceId = randomUUID(),
  agencyClientId = randomUUID(),
  companyContextId = randomUUID(),
  userId = randomUUID(),
  id = randomUUID();
const context = {
  tenantId,
  workspaceId,
  agencyClientId,
  companyContextId,
  userId,
  memberAccess: {
    leadflow_inbox: { available: true, level: 'operator' },
    leadflow_crm: { available: true, level: 'operator' },
  },
} as unknown as ClientAreaContext;
describe('CA11 closed scope adapter', () => {
  const row = {
    id,
    client: agencyClientId,
    company: companyContextId,
    creator: userId,
    parent: null,
    channel: null,
  };
  const setup = () => {
    const query = jest
      .fn<Promise<Record<string, unknown>[]>, [string, unknown[]]>()
      .mockResolvedValue([row]);
    const registry = new ClientAreaBridgeRegistry();
    const service = new LeadFlowClientAreaScopeService(
      { query } as unknown as DataSource,
      registry,
    );
    service.onModuleInit();
    return { query, registry, service };
  };
  it('registers all four product resolvers and never resolves unknown/admin/automation routes', async () => {
    const { registry, query } = setup();
    for (const routePath of [
      '/inbox/admin/outbox',
      '/leadflow/automations',
      '/inbox/channels/:id/disconnect',
    ])
      expect(
        await registry.resolveScope('leadflow_inbox', context, '', {
          method: 'POST',
          routePath,
          body: {},
        }),
      ).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
  it('proves the real company tuple even for another company of the same client', async () => {
    const { service, query } = setup();
    query.mockResolvedValue([{ ...row, company: randomUUID() }]);
    expect(
      await service.resolve('leadflow_crm', context, '', {
        method: 'GET',
        routePath: '/crm/opportunities/:id',
        params: { id },
      }),
    ).toBeNull();
  });
  it('binds Inbox own scope to the assignee and only permits assuming an unassigned conversation', async () => {
    const { service, query } = setup();
    query.mockResolvedValue([{ ...row, creator: randomUUID() }]);
    expect(
      await service.resolve('leadflow_inbox', context, '', {
        method: 'POST',
        routePath: '/inbox/conversations/:id/close',
        params: { id },
        body: {},
      }),
    ).toBeNull();
    query.mockResolvedValue([{ ...row, creator: null }]);
    expect(
      await service.resolve('leadflow_inbox', context, '', {
        method: 'POST',
        routePath: '/inbox/conversations/:id/assume',
        params: { id },
        body: {},
      }),
    ).toMatchObject({ createdById: userId });
  });
  it('rejects forged authors, internal metadata and foreign relational rows before commands', async () => {
    const { service } = setup();
    for (const body of [
      { senderUserId: userId },
      { metadata: { clientId: agencyClientId } },
      { direction: 'outbound', content: 'send' },
    ])
      expect(
        await service.resolve('leadflow_inbox', context, '', {
          method: 'POST',
          routePath: '/inbox/conversations/:id/messages',
          params: { id },
          body,
        }),
      ).toBeNull();
  });
  it('does not reinterpret a contact employer as company ownership', async () => {
    const { service, query } = setup();
    query.mockResolvedValue([]);
    expect(
      await service.resolve('leadflow_crm', context, '', {
        method: 'POST',
        routePath: '/crm/opportunities',
        body: { title: 'a', contactId: id },
      }),
    ).toBeNull();
    expect(query.mock.calls[0][0]).toContain('leadflow_contact_companies');
  });
  it('binds custom catalog mode to company settings', async () => {
    const { service, query } = setup();
    query.mockResolvedValue([{ mode: 'company-mode' }]);
    const request = {
      method: 'GET',
      routePath: '/crm/opportunity-fields',
      query: { businessMode: 'foreign-mode' },
    };
    expect(
      await service.resolve('leadflow_crm', context, '', request),
    ).toBeNull();
    request.query.businessMode = 'company-mode';
    expect(
      await service.resolve('leadflow_crm', context, '', request),
    ).not.toBeNull();
    expect(query.mock.calls[0][1]).toEqual([
      tenantId,
      workspaceId,
      agencyClientId,
      companyContextId,
    ]);
  });
  it.each(['handoffPolicy', 'crmPolicy'] as const)(
    'rejects a stage from another own pipeline in %s',
    async (policyName) => {
      const { service, query } = setup();
      const pipelineId = randomUUID(),
        stageId = randomUUID();
      query.mockImplementation((_sql: string, values: unknown[]) =>
        Promise.resolve([
          {
            ...row,
            id: values[4],
            parent: randomUUID(),
          },
        ]),
      );
      const policy =
        policyName === 'handoffPolicy'
          ? { targetPipelineId: pipelineId, targetStageId: stageId }
          : { pipelineRef: { pipelineId, stageId } };
      const managerContext = {
        ...context,
        memberAccess: {
          leadflow_agents: { available: true, level: 'manager' },
        },
      } as unknown as ClientAreaContext;
      expect(
        await service.resolve('leadflow_agents', managerContext, '', {
          method: 'PATCH',
          routePath: '/leadflow/agents/:id',
          params: { id },
          body: { [policyName]: policy },
        }),
      ).toBeNull();
    },
  );
  it('validates an omitted handoff stage retained by PATCH against a changed pipeline', async () => {
    const { service, query } = setup();
    const oldPipeline = randomUUID(),
      newPipeline = randomUUID(),
      stageId = randomUUID();
    query.mockImplementation((_sql: string, values: unknown[]) =>
      Promise.resolve([
        values[4] === id
          ? {
              ...row,
              handoff: {
                targetPipelineId: oldPipeline,
                targetStageId: stageId,
              },
            }
          : { ...row, id: values[4], parent: oldPipeline },
      ]),
    );
    const managerContext = {
      ...context,
      memberAccess: { leadflow_agents: { available: true, level: 'manager' } },
    } as unknown as ClientAreaContext;
    expect(
      await service.resolve('leadflow_agents', managerContext, '', {
        method: 'PATCH',
        routePath: '/leadflow/agents/:id',
        params: { id },
        body: { handoffPolicy: { targetPipelineId: newPipeline } },
      }),
    ).toBeNull();
    expect(
      await service.resolve('leadflow_agents', managerContext, '', {
        method: 'PATCH',
        routePath: '/leadflow/agents/:id',
        params: { id },
        body: { handoffPolicy: { targetPipelineId: oldPipeline } },
      }),
    ).not.toBeNull();
  });
});
