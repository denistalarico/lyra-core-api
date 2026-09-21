import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import {
  inboxEntityMatchesScope,
  resolveInboxCompanyScope,
} from './inbox-company-scope';

const companyA: RequestContext = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  managedContext: {
    productKey: 'leadflow',
    operatingMode: 'client',
    clientId: 'client-1',
    companyContextId: 'company-a',
    managedTenantId: 'managed-tenant-1',
  },
};

describe('Inbox company scope A/B isolation', () => {
  it('matches only the selected Company Context', () => {
    const companyB = {
      ...companyA,
      managedContext: {
        ...companyA.managedContext!,
        companyContextId: 'company-b',
      },
    };
    const entity = {
      agencyClientId: 'client-1',
      companyContextId: 'company-a',
      scopeKind: 'company' as const,
    };

    expect(inboxEntityMatchesScope(companyA, entity)).toBe(true);
    expect(inboxEntityMatchesScope(companyB, entity)).toBe(false);
  });

  it('rejects a client-mode request without an explicit Company Context', () => {
    expect(() =>
      resolveInboxCompanyScope({
        ...companyA,
        managedContext: {
          ...companyA.managedContext!,
          companyContextId: null,
        },
      }),
    ).toThrow(BadRequestException);
  });
});
