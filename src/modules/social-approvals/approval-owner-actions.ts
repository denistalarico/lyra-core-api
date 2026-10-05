import { BadRequestException } from '@nestjs/common';

export const APPROVAL_OWNER_ACTION_REQUIRED = 'approval_owner_action_required';

/**
 * Subjects whose approval request must be created by the owning module.
 *
 * Creating the request is a business operation of the owner domain, not only
 * of Approvals: the Creative Studio reflects `creative_ready` on the Planner
 * when it hands a version over (CS2B.4). The generic `POST /social/approvals`
 * would create the same request without those effects, so it refuses these
 * subjects instead of duplicating them.
 *
 * Only route strings live here — Approvals still depends on neither module.
 * `SocialApprovalsService.create()` stays the internal contract the owner
 * endpoints call; this guard belongs to the generic HTTP entry point only.
 */
export const APPROVAL_SUBJECT_OWNER_ACTIONS: ReadonlyMap<
  string,
  { owner: string; action: string }
> = new Map([
  [
    'creative_version',
    {
      owner: 'Creative Studio',
      action:
        'POST /social/creative-studio/assets/:id/versions/:versionId/send-for-approval',
    },
  ],
  [
    'planner_content_revision',
    {
      owner: 'Social Planner',
      action:
        'POST /social/planner/content/:contentId/revisions/:revisionId/send-for-approval',
    },
  ],
]);

export class ApprovalOwnerActionRequiredException extends BadRequestException {
  constructor(subjectType: string, owner: { owner: string; action: string }) {
    super({
      statusCode: 400,
      error: 'Bad Request',
      code: APPROVAL_OWNER_ACTION_REQUIRED,
      message: `Aprovações de ${subjectType} devem ser criadas pelo módulo ${owner.owner}.`,
      subjectType,
      ownerAction: owner.action,
    });
  }
}
