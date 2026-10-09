import {
  type CompanyAwareScope,
  CompanyContextRequiredException,
} from '../../common/context/company-aware-scope';
import type { SocialApprovalStage } from './entities';

/**
 * CS5 Closeout — which stages an approval request walks, decided only by the
 * scope it belongs to:
 *
 *   managed client  (client + company)   internal → client → approved
 *   own             (null, null)         internal → approved
 *
 * "Own" is the tenant operating its own Social: an agency producing for
 * itself, or a B2B company running its own channels. The platform has no
 * tenant kind that tells the two apart, and both are structurally the same
 * scope, so both get the internal stage only. No configuration exists or is
 * implied: this table is the policy.
 *
 * Legacy `(client, null)` scope cannot hold a request (CC2G): it never
 * degrades to client-wide data, so it is refused here exactly as before.
 */
export type ApprovalScopeKind = 'own' | 'managed_client';

const OWN_STAGES: readonly SocialApprovalStage[] = Object.freeze(['internal']);
const MANAGED_CLIENT_STAGES: readonly SocialApprovalStage[] = Object.freeze([
  'internal',
  'client',
]);

type ScopeIds = Pick<CompanyAwareScope, 'agencyClientId' | 'companyContextId'>;

export function approvalScopeKind(scope: ScopeIds): ApprovalScopeKind {
  if (scope.agencyClientId === null && scope.companyContextId === null)
    return 'own';
  if (scope.agencyClientId && scope.companyContextId) return 'managed_client';
  throw new CompanyContextRequiredException();
}

export function approvalStagesFor(
  scope: ScopeIds,
): readonly SocialApprovalStage[] {
  return approvalScopeKind(scope) === 'own'
    ? OWN_STAGES
    : MANAGED_CLIENT_STAGES;
}

/** Whether an internal approval is the final decision for this scope. */
export function internalApprovalIsFinal(scope: ScopeIds): boolean {
  return !approvalStagesFor(scope).includes('client');
}
