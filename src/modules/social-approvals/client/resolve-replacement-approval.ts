import type { Repository } from 'typeorm';
import { IsNull, Not } from 'typeorm';
import type { CompanyAwareScope } from '../../../common/context/company-aware-scope';
import type { SocialApprovalRequestEntity } from '../entities';

/**
 * AP4 §13–§21 — "this version was replaced" without ever inferring the
 * replacement from title, `created_at` or Company alone.
 *
 * The only identity this trusts is the one AP1/AP2 already enforce: the same
 * logical subject root (`subjectType` + `subjectId`) inside the exact same
 * `CompanyAwareScope` tuple. `SocialApprovalsService.create()` is the single
 * writer that ever marks a request `superseded`, and it does so only for
 * other active requests of that same root — so a `superseded` row and its
 * replacement always share root and scope by construction. This helper does
 * not persist a `previous_approval_id`/`replacement_approval_id` column: the
 * association is already derivable, and duplicating it as a second source of
 * truth would be exactly the drift AP3's "no second state machine" rule
 * guards against (§15, §37).
 *
 * ELIGIBILITY, ALL REQUIRED
 * -------------------------
 *  1. Same scope tuple (tenant/workspace/agencyClient/companyContext) as the
 *     superseded approval — never widened to "same tenant" or "same Agency
 *     Client" (§19).
 *  2. Same `subjectType` + `subjectId` (the root), a different
 *     `subjectRevisionId` than the superseded approval (§15).
 *  3. `createdAt` after the superseded approval's `createdAt` — the
 *     replacement is always a later revision, never a sibling or an earlier
 *     one (§14: never inferred from "most recent" alone, only ever compared
 *     within the already-proven root).
 *  4. `sentToClientAt IS NOT NULL` — the replacement must itself be
 *     client-visible. A replacement still in internal review, never sent, or
 *     cancelled before being sent is not offered (§20).
 *
 * CHAIN COLLAPSE (§21)
 * ---------------------
 * rev1 -> rev2 -> rev3: opening rev1 should not stop at rev2 if rev2 was
 * itself superseded by rev3. This always resolves to the *latest* eligible
 * row by `createdAt` for the root, so rev1 points straight at rev3. There is
 * no recursive "follow the chain" traversal (no loop is possible), because
 * "latest client-visible row for this root newer than me" already lands on
 * the end of the chain in one query.
 */
export async function resolveReplacementApproval(
  requests: Pick<Repository<SocialApprovalRequestEntity>, 'findOne'>,
  scope: CompanyAwareScope,
  superseded: Pick<
    SocialApprovalRequestEntity,
    'subjectType' | 'subjectId' | 'subjectRevisionId' | 'createdAt'
  >,
): Promise<SocialApprovalRequestEntity | null> {
  const replacement = await requests.findOne({
    where: {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId!,
      companyContextId: scope.companyContextId!,
      subjectType: superseded.subjectType,
      subjectId: superseded.subjectId,
      sentToClientAt: Not(IsNull()),
    },
    order: { createdAt: 'DESC' },
  });

  if (!replacement) return null;
  if (replacement.subjectRevisionId === superseded.subjectRevisionId)
    return null;
  if (replacement.createdAt <= superseded.createdAt) return null;

  return replacement;
}
