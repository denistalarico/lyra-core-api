import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import type { ClientAreaContext } from './client-area.types';

/**
 * The one permitted bridge from a Client Area request to company-aware domain
 * services (e.g. `ApprovalClientReviewService`).
 *
 * Every id comes from the membership row the guard just validated — never
 * from the path, a header or the body — and the result is always a full
 * company scope. Agency code derives its scope with
 * `resolveCompanyAwareScope(RequestContext)`; the Client Area must never go
 * through that function, because it would read Agency `managedContext` and
 * operator semantics.
 */
export function toCompanyAwareScope(
  context: ClientAreaContext,
): CompanyAwareScope {
  return {
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    agencyClientId: context.agencyClientId,
    companyContextId: context.companyContextId,
  };
}
