import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import {
  inboxEntityMatchesScope,
  inboxScopeRequestContext,
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

describe('inboxScopeRequestContext (unattended sends)', () => {
  const base = { tenantId: 'tenant-1', workspaceId: 'workspace-1' };

  it('carries a company conversation into its own company', () => {
    const conversation = {
      ...base,
      scopeKind: 'company' as const,
      agencyClientId: 'client-1',
      companyContextId: 'company-a',
    };
    const ctx = inboxScopeRequestContext(conversation);

    // The bug this guards: a bare tenant/workspace resolved to agency scope,
    // so the agent reply and the WhatsApp automation never found a company
    // channel.
    expect(inboxEntityMatchesScope(base, conversation)).toBe(false);
    expect(inboxEntityMatchesScope(ctx, conversation)).toBe(true);
    expect(
      inboxEntityMatchesScope(ctx, {
        ...conversation,
        companyContextId: 'company-b',
      }),
    ).toBe(false);
  });

  it('keeps an agency conversation in agency scope', () => {
    const conversation = {
      ...base,
      scopeKind: 'agency' as const,
      agencyClientId: null,
      companyContextId: null,
    };
    const ctx = inboxScopeRequestContext(conversation);

    expect(ctx.managedContext).toBeUndefined();
    expect(inboxEntityMatchesScope(ctx, conversation)).toBe(true);
  });

  it('never lets a legacy bucket pose as a company', () => {
    const ctx = inboxScopeRequestContext({
      ...base,
      scopeKind: 'legacy_unassigned',
      agencyClientId: 'client-1',
      companyContextId: null,
    });

    expect(ctx.managedContext).toBeUndefined();
  });
});
