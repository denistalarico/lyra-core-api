import {
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { creativeStudioScope } from './creative-studio.scope';
import { CreativeVersionApprovalService } from './creative-version-approval.service';

const SUBMIT_REVIEW = 'social.creative.content.submit_review.assigned';

/**
 * CS2B.2 — kept apart from `CreativeStudioController` so the approval entry
 * point does not share a file with asset/brand-context work. Same route
 * prefix, guards and entitlement as the main Studio controller.
 */
@Controller('social/creative-studio')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class CreativeVersionApprovalController {
  constructor(private readonly approvals: CreativeVersionApprovalService) {}

  /** The Studio owns the version; Approvals receives only its immutable identity. */
  @Post('assets/:id/versions/:versionId/send-for-approval')
  @RequirePermission(SUBMIT_REVIEW)
  sendVersionForApproval(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ) {
    return this.approvals.sendForApproval(
      creativeStudioScope(ctx),
      ctx.userId,
      id,
      versionId,
    );
  }
}
