import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import {
  SocialClientAreaInterceptor,
  socialClientResponse,
} from './social-client-area.interceptor';

const execution = (request: object) =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;
const handler = (value: unknown): CallHandler => ({ handle: () => of(value) });

describe('CA10 Social Client Area response projection', () => {
  const internal = {
    id: 'content-1',
    createdById: 'user-1',
    companyContextId: 'company-1',
    contentPath: '/social/creative-studio/assets/a/content',
    createdAt: new Date('2026-10-19T12:00:00.000Z'),
    tenantId: 't',
    workspaceId: 'w',
    agencyClientId: 'c',
    managedTenantId: 'm',
    storagePath: 'bucket/key',
    costCents: 10,
    selectedVersionAiCost: { amount: '1.00' },
    effectivePrompt: 'agency prompt',
    providerMetadata: { raw: true },
    items: [{ id: 'nested', tenantId: 't', lockedBy: 'worker-1' }],
  };

  it('removes agency-internal keys at any depth and keeps the client view', () => {
    expect(socialClientResponse(internal)).toEqual({
      id: 'content-1',
      createdById: 'user-1',
      companyContextId: 'company-1',
      contentPath: '/social/creative-studio/assets/a/content',
      createdAt: new Date('2026-10-19T12:00:00.000Z'),
      items: [{ id: 'nested' }],
    });
    expect(socialClientResponse(null)).toBeNull();
    expect(socialClientResponse('csv,body')).toBe('csv,body');
  });

  it('projects only Client Area requests on Social routes', async () => {
    const interceptor = new SocialClientAreaInterceptor();
    const run = (request: object) =>
      lastValueFrom(
        interceptor.intercept(execution(request), handler(internal)),
      );
    const route = { path: '/api/social/planner/content/:contentId' };
    await expect(
      run({ method: 'GET', route, clientAreaContext: {} }),
    ).resolves.not.toHaveProperty('tenantId');
    // Agency operator on the same route: untouched.
    await expect(run({ method: 'GET', route })).resolves.toBe(internal);
    // Client Area context on a route outside the Social table: untouched.
    await expect(
      run({
        method: 'GET',
        route: { path: '/api/agency/projects' },
        clientAreaContext: {},
      }),
    ).resolves.toBe(internal);
  });
});
