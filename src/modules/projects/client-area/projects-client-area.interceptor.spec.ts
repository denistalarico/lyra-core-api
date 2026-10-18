import { lastValueFrom, of } from 'rxjs';
import { ClientAreaBridgeRegistry } from '../../../common/client-area-bridge/client-area-bridge.registry';
import { ProjectsClientAreaInterceptor } from './projects-client-area.interceptor';
import { projectClientResponse } from './projects-client-area.interceptor';
describe('CA9 field-by-field projections', () => {
  it('removes current and future internal fields from cards and nested boards', () => {
    const task = {
      id: 'card',
      title: 'Visible',
      trackedMinutes: 40,
      estimatedMinutes: 90,
      blockedReason: 'Internal note',
      coverImageAssetKey: 'private-key',
      tenantId: 'tenant',
      futureSecret: 'secret',
    };
    expect(projectClientResponse(task, 'task')).toEqual({
      id: 'card',
      title: 'Visible',
    });
    expect(
      projectClientResponse(
        {
          columns: [
            { id: 'stage', name: 'Doing', settings: 'internal', cards: [task] },
          ],
          unassigned: { id: null, name: 'Other', cards: [] },
        },
        'task-board',
      ),
    ).toEqual({
      columns: [
        {
          id: 'stage',
          name: 'Doing',
          cards: [{ id: 'card', title: 'Visible' }],
        },
      ],
      unassigned: { id: null, name: 'Other', cards: [] },
    });
  });
  it('omits internal notes/system events and public project passwords', () => {
    expect(
      projectClientResponse(
        [
          { id: 'a', kind: 'note', body: 'Secret' },
          { id: 'b', kind: 'system', body: 'Internal' },
          {
            id: 'c',
            kind: 'activity',
            body: 'Client',
            meta: { private: true },
          },
        ],
        'event',
      ),
    ).toEqual([{ id: 'c', kind: 'activity', body: 'Client' }]);
    expect(
      projectClientResponse(
        { id: 'p', publicPagePassword: 'secret', isPublicPageEnabled: true },
        'project',
      ),
    ).toEqual({ id: 'p' });
  });
  it('resolves client authors in both surfaces while preserving Agency fields', async () => {
    const registry = new ClientAreaBridgeRegistry();
    registry.registerActorDirectory(() =>
      Promise.resolve({ client: 'Client (cliente)' }),
    );
    const interceptor = new ProjectsClientAreaInterceptor(registry);
    const request = {
      user: { sub: 'operator', tenantId: 'tenant', workspaceId: 'workspace' },
      route: { path: '/api/agency/projects/tasks/:taskId/comments' },
      clientAreaContext: undefined as object | undefined,
    };
    const execution = { switchToHttp: () => ({ getRequest: () => request }) };
    const raw = [
      {
        id: 'comment',
        authorId: 'client',
        body: 'Visible',
        tenantId: 'tenant',
        internal: 'kept in Agency',
      },
    ];
    const agency: unknown = await lastValueFrom(
      interceptor.intercept(execution as never, { handle: () => of(raw) }),
    );
    expect(agency).toEqual([{ ...raw[0], authorName: 'Client (cliente)' }]);
    request.clientAreaContext = { tenantId: 'tenant' };
    const client: unknown = await lastValueFrom(
      interceptor.intercept(execution as never, { handle: () => of(raw) }),
    );
    expect(client).toEqual([
      {
        id: 'comment',
        authorId: 'client',
        body: 'Visible',
        authorName: 'Client (cliente)',
      },
    ]);
  });
});
