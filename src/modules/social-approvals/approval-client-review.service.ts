import { Injectable } from '@nestjs/common';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { SocialApprovalsService } from './social-approvals.service';

/**
 * Application boundary reserved for Client Area. It deliberately accepts a
 * real authenticated user id rather than an Agency role, Contact or Company.
 * Client Area must prove membership and approvals permission before invoking it.
 */
@Injectable()
export class ApprovalClientReviewService {
  constructor(private readonly approvals: SocialApprovalsService) {}

  view(scope: CompanyAwareScope, approvalId: string, actorUserId: string) {
    return this.approvals.markClientViewed(scope, approvalId, actorUserId);
  }

  comment(
    scope: CompanyAwareScope,
    approvalId: string,
    actorUserId: string,
    body: string,
  ) {
    return this.approvals.clientComment(scope, approvalId, actorUserId, body);
  }

  approve(scope: CompanyAwareScope, approvalId: string, actorUserId: string) {
    return this.approvals.clientApprove(scope, approvalId, {
      type: 'user',
      userId: actorUserId,
    });
  }

  requestChanges(
    scope: CompanyAwareScope,
    approvalId: string,
    actorUserId: string,
    body: string,
  ) {
    return this.approvals.clientRequestChanges(
      scope,
      approvalId,
      { type: 'user', userId: actorUserId },
      body,
    );
  }
}
