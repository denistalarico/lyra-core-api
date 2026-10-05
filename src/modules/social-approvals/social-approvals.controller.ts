import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import {
  AddSocialApprovalCommentDto,
  CreateSocialApprovalDto,
  ListSocialApprovalsDto,
} from './dto/social-approval.dto';
import { SocialApprovalsService } from './social-approvals.service';
import {
  APPROVAL_SUBJECT_OWNER_ACTIONS,
  ApprovalOwnerActionRequiredException,
} from './approval-owner-actions';

@Controller('social/approvals')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class SocialApprovalsController {
  constructor(private readonly approvals: SocialApprovalsService) {}
  @Get() @RequirePermission('social.approvals.review.view.assigned') list(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ListSocialApprovalsDto,
  ) {
    return this.approvals.list(resolveCompanyAwareScope(ctx), query);
  }
  @Get(':id')
  @RequirePermission('social.approvals.review.view.assigned')
  detail(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.detail(resolveCompanyAwareScope(ctx), id);
  }
  @Get(':id/preview')
  @RequirePermission('social.approvals.review.view.assigned')
  preview(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.preview(resolveCompanyAwareScope(ctx), id);
  }
  @Post(':id/view')
  @RequirePermission('social.approvals.review.view.assigned')
  view(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.markAgencyViewed(
      resolveCompanyAwareScope(ctx),
      id,
      ctx.userId,
    );
  }
  @Post() @RequirePermission('social.approvals.review.comment.assigned') create(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateSocialApprovalDto,
  ) {
    // Refused before any scope or subject lookup: owner-domain subjects are
    // created only through their owner module (see approval-owner-actions).
    const owner = APPROVAL_SUBJECT_OWNER_ACTIONS.get(dto.subjectType);
    if (owner)
      throw new ApprovalOwnerActionRequiredException(dto.subjectType, owner);
    return this.approvals.create(
      resolveCompanyAwareScope(ctx),
      ctx.userId,
      dto,
    );
  }
  @Post(':id/submit')
  @RequirePermission('social.approvals.review.comment.assigned')
  submit(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.submit(resolveCompanyAwareScope(ctx), id, ctx.userId);
  }
  @Post(':id/comment')
  @RequirePermission('social.approvals.review.comment.assigned')
  comment(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddSocialApprovalCommentDto,
  ) {
    // AP4 §5 — the DTO field is optional and the service default is
    // `internal`; a request that never set `visibility` cannot leak.
    return this.approvals.comment(
      resolveCompanyAwareScope(ctx),
      id,
      ctx.userId,
      dto.body,
      dto.visibility,
    );
  }
  @Post(':id/internal/approve')
  @RequirePermission('social.approvals.review.approve_internal.manager')
  approveInternal(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.approveInternal(
      resolveCompanyAwareScope(ctx),
      id,
      ctx.userId,
    );
  }
  @Post(':id/request-changes')
  @RequirePermission('social.approvals.review.request_changes.manager')
  requestChanges(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddSocialApprovalCommentDto,
  ) {
    return this.approvals.requestChanges(
      resolveCompanyAwareScope(ctx),
      id,
      ctx.userId,
      dto.body,
    );
  }
  @Post(':id/cancel')
  @RequirePermission('social.approvals.review.override.owner_or_admin_explicit')
  cancel(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.cancel(resolveCompanyAwareScope(ctx), id, ctx.userId);
  }
}
