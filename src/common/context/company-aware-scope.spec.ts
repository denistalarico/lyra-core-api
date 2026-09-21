import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from './request-context.interface';
import { resolveCompanyAwareScope } from './company-aware-scope';

const baseContext = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  userId: '30000000-0000-4000-8000-000000000001',
  role: 'owner',
} as RequestContext;

describe('resolveCompanyAwareScope', () => {
  it('maps agency mode to the explicit agency pair', () => {
    expect(
      resolveCompanyAwareScope({
        ...baseContext,
        managedContext: {
          productKey: 'social',
          operatingMode: 'agency',
          clientId: null,
          companyContextId: null,
          managedTenantId: null,
        },
      }),
    ).toEqual({
      tenantId: baseContext.tenantId,
      workspaceId: baseContext.workspaceId,
      agencyClientId: null,
      companyContextId: null,
    });
  });

  it('accepts company scope only from the resolved managed context', () => {
    expect(
      resolveCompanyAwareScope({
        ...baseContext,
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: '40000000-0000-4000-8000-000000000001',
          companyContextId: '50000000-0000-4000-8000-000000000001',
          managedTenantId: '60000000-0000-4000-8000-000000000001',
        },
      }),
    ).toEqual({
      tenantId: baseContext.tenantId,
      workspaceId: baseContext.workspaceId,
      agencyClientId: '40000000-0000-4000-8000-000000000001',
      companyContextId: '50000000-0000-4000-8000-000000000001',
    });
  });

  it('rejects client mode without a selected company instead of widening to client scope', () => {
    expect(() =>
      resolveCompanyAwareScope({
        ...baseContext,
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: '40000000-0000-4000-8000-000000000001',
          companyContextId: null,
          managedTenantId: '60000000-0000-4000-8000-000000000001',
        },
      }),
    ).toThrow(BadRequestException);
  });
});
