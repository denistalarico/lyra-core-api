import type { RequestContext } from '../../common/context/request-context.interface';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';

export type InboxScopeKind = 'agency' | 'company' | 'legacy_unassigned';

export type InboxCompanyScope =
  | {
      tenantId: string;
      workspaceId: string;
      agencyClientId: null;
      companyContextId: null;
      scopeKind: 'agency';
    }
  | {
      tenantId: string;
      workspaceId: string;
      agencyClientId: string;
      companyContextId: string;
      scopeKind: 'company';
    };

/**
 * Operational Inbox writes never create the legacy bucket. Historical rows
 * receive `legacy_unassigned` only in the CC2E migrations; request-driven
 * agency and company operations always resolve to one of the two live scopes.
 */
export function resolveInboxCompanyScope(
  ctx: RequestContext,
): InboxCompanyScope {
  const scope = resolveCompanyAwareScope(ctx);
  if (scope.agencyClientId && scope.companyContextId) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      scopeKind: 'company',
    };
  }
  return {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    agencyClientId: null,
    companyContextId: null,
    scopeKind: 'agency',
  };
}

export function inboxEntityMatchesScope(
  ctx: RequestContext,
  entity: {
    agencyClientId: string | null;
    companyContextId: string | null;
    scopeKind: InboxScopeKind;
  },
): boolean {
  const scope = resolveInboxCompanyScope(ctx);
  return (
    entity.scopeKind === scope.scopeKind &&
    entity.agencyClientId === scope.agencyClientId &&
    entity.companyContextId === scope.companyContextId
  );
}
