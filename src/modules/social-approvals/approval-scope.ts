import { IsNull } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { approvalScopeKind } from './approval-stage.policy';

/**
 * TypeORM 0.3 drops a raw `null` from a find `where` (default
 * `invalidWhereValuesBehavior.null = 'ignore'`), so agency scope
 * `(null, null)` used to mean "no client/company filter at all". Every nullable
 * scope column goes through here so `null` always means `IS NULL`.
 */
const eqOrIsNull = (value: string | null) =>
  value === null ? IsNull() : value;

/** Full company-aware predicate: tenant, workspace, client and company. */
export function approvalScopeWhere(scope: CompanyAwareScope) {
  return {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    agencyClientId: eqOrIsNull(scope.agencyClientId),
    companyContextId: eqOrIsNull(scope.companyContextId),
  };
}

/** For roots without a company column (Planner items/revisions). */
export function approvalClientWhere(scope: CompanyAwareScope) {
  return {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    agencyClientId: eqOrIsNull(scope.agencyClientId),
  };
}

/**
 * An approval request belongs either to a Company Context (both ids, tied to
 * `agency_client_company_contexts` by `FK_social_approval_requests_company`)
 * or, since the CS5 Closeout, to the tenant's own scope `(null, null)` — the
 * agency producing for itself or a B2B company running its own Social. No
 * synthetic Company Context is ever created for the latter.
 * `CK_social_approval_requests_scope` keeps legacy `(client, null)` out.
 */
export function assertApprovalScope(scope: CompanyAwareScope): void {
  approvalScopeKind(scope);
}
