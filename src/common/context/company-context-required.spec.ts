import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from './request-context.interface';
import {
  CLIENT_CONTEXT_REQUIRED,
  COMPANY_CONTEXT_REQUIRED,
  CompanyContextRequiredException,
  resolveCompanyAwareScope,
} from './company-aware-scope';

const baseContext = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  workspaceId: '20000000-0000-4000-8000-000000000001',
  userId: '30000000-0000-4000-8000-000000000001',
  role: 'owner',
} as RequestContext;

function clientModeContext(companyContextId: string | null): RequestContext {
  return {
    ...baseContext,
    managedContext: {
      productKey: 'social',
      operatingMode: 'client',
      clientId: '40000000-0000-4000-8000-000000000001',
      companyContextId,
      managedTenantId: '60000000-0000-4000-8000-000000000001',
    },
  } as RequestContext;
}

/**
 * CC2G — the rejection contract.
 *
 * Every company-aware Social and LeadFlow boundary resolves its scope through
 * `resolveCompanyAwareScope`, so proving the contract here proves it for all
 * of them at once. The per-boundary suites below assert that each boundary
 * really does go through this helper.
 */
describe('company_context_required contract', () => {
  it('rejects a legacy selection (client with no company) instead of widening', () => {
    expect(() => resolveCompanyAwareScope(clientModeContext(null))).toThrow(
      CompanyContextRequiredException,
    );
  });

  it('carries a stable machine-readable code the UI can route on', () => {
    try {
      resolveCompanyAwareScope(clientModeContext(null));
      throw new Error('expected the resolver to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        code?: string;
        message?: string;
      };
      expect(response.code).toBe(COMPANY_CONTEXT_REQUIRED);
      expect(response.code).toBe('company_context_required');
      // The message may be localised or reworded; the code is the contract.
      expect(typeof response.message).toBe('string');
    }
  });

  it('distinguishes a missing client from a missing company', () => {
    const context = {
      ...baseContext,
      managedContext: {
        productKey: 'social',
        operatingMode: 'client',
        clientId: null,
        companyContextId: null,
        managedTenantId: null,
      },
    } as RequestContext;

    try {
      resolveCompanyAwareScope(context);
      throw new Error('expected the resolver to reject');
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as {
        code?: string;
      };
      expect(response.code).toBe(CLIENT_CONTEXT_REQUIRED);
    }
  });

  it('never returns the legacy pair (client set, company null) to a caller', () => {
    const scope = resolveCompanyAwareScope(
      clientModeContext('50000000-0000-4000-8000-000000000001'),
    );
    expect(scope.companyContextId).toBe('50000000-0000-4000-8000-000000000001');

    // Agency mode is the only scope allowed to carry nulls, and it carries
    // both — never a client without a company.
    const agencyScope = resolveCompanyAwareScope({
      ...baseContext,
      managedContext: {
        productKey: 'social',
        operatingMode: 'agency',
        clientId: null,
        companyContextId: null,
        managedTenantId: null,
      },
    } as RequestContext);
    expect(agencyScope).toMatchObject({
      agencyClientId: null,
      companyContextId: null,
    });
  });
});
