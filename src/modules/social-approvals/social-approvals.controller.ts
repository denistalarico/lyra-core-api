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
    return this.approvals.comment(
      resolveCompanyAwareScope(ctx),
      id,
      ctx.userId,
      dto.body,
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
