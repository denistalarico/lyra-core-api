import { Controller, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditChangeInterceptor } from './services/audit-change.interceptor';
import { ClientAreaExposed } from './client-area.decorators';

@Controller('client-area/companies/:companyContextId')
class Facade {
  update() {}
}
@Controller('agency/tasks')
class AgencyRoute {
  @ClientAreaExposed('agency_projects') update() {}
}

describe('CA7 automatic audit capture', () => {
  const tenantId = randomUUID(),
    workspaceId = randomUUID(),
    userId = randomUUID(),
    companyContextId = randomUUID(),
    agencyClientId = randomUUID();
  function setup(
    controller: typeof Facade | typeof AgencyRoute,
    options: { status?: number; method?: string; client?: boolean } = {},
  ) {
    const record = jest.fn().mockResolvedValue(undefined);
    const interceptor = new AuditChangeInterceptor(new Reflector(), {
      record,
    } as never);
    const request = {
      method: options.method ?? 'PATCH',
      user: { tenantId, workspaceId, sub: userId },
      params: { clientId: agencyClientId, companyContextId },
      route: { path: 'test' },
      body: { password: 'never-store-this', title: 'private-content' },
      headers: { 'user-agent': 'test' },
      ...(options.client
        ? {
            clientAreaIdentity: { userId, tenantId },
            clientAreaContext: {
              tenantId,
              workspaceId,
              userId,
              companyContextId,
              agencyClientId,
            },
          }
        : {}),
    };
    const execution = {
      getClass: () => controller,
      getHandler: () => controller.prototype.update,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ statusCode: options.status ?? 200 }),
      }),
    } as unknown as ExecutionContext;
    return { record, interceptor, execution };
  }
  it.each([false, true])(
    'records a successful exposed mutation from either surface (client=%s) without body values',
    async (client) => {
      const { record, interceptor, execution } = setup(AgencyRoute, { client });
      await lastValueFrom(
        interceptor.intercept(execution, { handle: () => of({ ok: true }) }),
      );
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          companyContextId,
          agencyClientId,
          actorUserId: userId,
          actorSurface: client ? 'client_area' : 'agency',
          changedFields: ['password', 'title'],
          moduleKey: 'agency_projects',
        }),
      );
      expect(JSON.stringify(record.mock.calls)).not.toContain(
        'never-store-this',
      );
      expect(JSON.stringify(record.mock.calls)).not.toContain(
        'private-content',
      );
    },
  );
  it('captures facades automatically and ignores reads and failed operations', async () => {
    const write = setup(Facade, { client: true });
    await lastValueFrom(
      write.interceptor.intercept(write.execution, {
        handle: () => of({ ok: true }),
      }),
    );
    expect(write.record).toHaveBeenCalledTimes(1);
    for (const options of [{ method: 'GET' }, { status: 409 }]) {
      const test = setup(Facade, options);
      await lastValueFrom(
        test.interceptor.intercept(test.execution, { handle: () => of({}) }),
      );
      expect(test.record).not.toHaveBeenCalled();
    }
    const test = setup(Facade);
    await expect(
      lastValueFrom(
        test.interceptor.intercept(test.execution, {
          handle: () => throwError(() => new Error('domain failure')),
        }),
      ),
    ).rejects.toThrow('domain failure');
    expect(test.record).not.toHaveBeenCalled();
  });
});
