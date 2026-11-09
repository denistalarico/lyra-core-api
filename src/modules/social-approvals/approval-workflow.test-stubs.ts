import { randomUUID } from 'node:crypto';
import type { SocialApprovalAuthorityService } from './social-approval-authority.service';
import type { SocialApprovalPiecesService } from './social-approval-pieces.service';
import type { SocialApprovalSettingsService } from './social-approval-settings.service';

type WorkflowCollaborators = [
  SocialApprovalPiecesService,
  SocialApprovalAuthorityService,
  SocialApprovalSettingsService,
];

/**
 * For specs that exercise something else (scope, owner modules, the status
 * machine) and construct `SocialApprovalsService` by hand. Everything allows
 * and records nothing; the real rules are covered by
 * `approval-pieces.postgres.spec.ts`.
 */
export function approvalWorkflowStubs(): WorkflowCollaborators {
  const pieces = {
    resolveStep: () => Promise.resolve({ id: randomUUID(), pieceId: randomUUID() }),
    attachRequest: () => Promise.resolve(undefined),
    afterTransition: () => Promise.resolve(undefined),
    recordRequestEvent: () => Promise.resolve(undefined),
    recordEvent: () => Promise.resolve(undefined),
  };
  const authority = {
    canDecideInternal: () => true,
    assertInternalDecider: () => undefined,
    requiredClientApprovers: () => Promise.resolve(null),
    assertClientDecider: () => Promise.resolve(undefined),
    canDecideClient: () => Promise.resolve(true),
    eligibleClientApprovers: () => Promise.resolve([]),
    roundApprovals: () => Promise.resolve(new Set<string>()),
  };
  const settings = {
    get: () =>
      Promise.resolve({
        scopeKind: 'managed_client',
        internalApprovalEnabled: true,
        internalApproverUserIds: [],
        clientApproverMembershipIds: [],
        clientDecisionPolicy: 'first',
      }),
  };
  return [pieces, authority, settings] as unknown as WorkflowCollaborators;
}
