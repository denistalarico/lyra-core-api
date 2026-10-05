import { IsNull } from 'typeorm';
import {
  type CompanyAwareScope,
  CompanyContextRequiredException,
} from '../../common/context/company-aware-scope';

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
 * An approval request always belongs to a Company Context:
 * `CK_social_approval_requests_scope` requires both ids and
 * `FK_social_approval_requests_company` ties them to
 * `agency_client_company_contexts`. Agency `(null, null)` and legacy
 * `(client, null)` scopes therefore cannot open one.
 */
export function assertApprovalCompanyScope(
  scope: CompanyAwareScope,
): asserts scope is CompanyAwareScope & {
  agencyClientId: string;
  companyContextId: string;
} {
  if (!scope.agencyClientId || !scope.companyContextId)
    throw new CompanyContextRequiredException();
}
