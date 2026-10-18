import { randomUUID } from 'node:crypto';
import { ClientAreaBridgeRegistry } from '../../../common/client-area-bridge/client-area-bridge.registry';
import type { ClientAreaContext } from '../../client-area/client-area.types';
import { ProjectsClientAreaScopeService } from './projects-client-area-scope.service';
const context = {
  tenantId: randomUUID(),
  workspaceId: randomUUID(),
  agencyClientId: randomUUID(),
  companyContextId: randomUUID(),
  userId: randomUUID(),
  memberAccess: { agency_projects: { level: 'operator' } },
} as ClientAreaContext;
const own = randomUUID(),
  foreign = randomUUID(),
  other = randomUUID();
const query = jest.fn((sql: string, values: unknown[]) =>
  Promise.resolve(
    sql.includes('agency_tasks') && values[3] === own
      ? [{ id: own, createdById: context.userId }]
      : sql.includes('agency_tasks') && values[3] === other
        ? [{ id: other, createdById: randomUUID() }]
        : [],
  ),
);
const registry = new ClientAreaBridgeRegistry();
const service = new ProjectsClientAreaScopeService(
  { query } as never,
  registry,
);
service.onModuleInit();
describe('CA9 Projects scope adapter', () => {
  it('resolves audited collections and refuses workspace configuration', async () => {
    expect(
      await registry.resolveScope('agency_projects', context, '', {
        method: 'GET',
        routePath: '/agency/projects/board',
      }),
    ).toMatchObject({
      agencyClientId: context.agencyClientId,
      companyContextId: context.companyContextId,
    });
    expect(
      await service.resolve(context, '', {
        method: 'GET',
        routePath: '/agency/projects/settings',
      }),
    ).toBeNull();
  });
  it('forces client ownership on create and rejects internal write fields', async () => {
    const body = { clientId: foreign, title: 'Client card' };
    expect(
      await service.resolve(context, '', {
        method: 'POST',
        routePath: '/agency/projects/tasks',
        body,
      }),
    ).not.toBeNull();
    expect(body.clientId).toBe(context.agencyClientId);
    expect(
      await service.resolve(context, '', {
        method: 'PATCH',
        routePath: '/agency/projects/tasks/:id',
        params: { id: own },
        body: { trackedMinutes: 40 },
      }),
    ).toBeNull();
  });
  it('allows editing another creator card, but denies PATCH archive and foreign resources', async () => {
    const request = {
      method: 'PATCH',
      routePath: '/agency/projects/tasks/:id',
      params: { id: other },
      body: { title: 'Changed' },
    };
    expect(await service.resolve(context, '', request)).not.toBeNull();
    expect(
      await service.resolve(context, '', {
        ...request,
        body: { status: 'archived' },
      }),
    ).toBeNull();
    expect(
      await service.resolve(context, '', {
        ...request,
        params: { id: foreign },
      }),
    ).toBeNull();
    expect(
      await service.resolve(context, '', {
        ...request,
        params: { id: own },
        body: { projectId: foreign },
      }),
    ).toBeNull();
  });
});
