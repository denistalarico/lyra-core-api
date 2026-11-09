import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  PlatformPermissionService,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import {
  AddSocialApprovalCommentDto,
  CreateSocialApprovalDto,
  ListSocialApprovalInboxDto,
  ListSocialApprovalsDto,
} from './dto/social-approval.dto';
import {
  CreateStandalonePieceDto,
  FinishSocialApprovalPieceDto,
  SocialApprovalBoardQueryDto,
  UpdateSocialApprovalSettingsDto,
} from './dto/social-approval-piece.dto';
import { SocialApprovalBoardService } from './social-approval-board.service';
import { SocialApprovalMediaService } from './social-approval-media.service';
import { SocialApprovalPieceActionsService } from './social-approval-piece-actions.service';
import { SocialApprovalSettingsService } from './social-approval-settings.service';
import { SocialApprovalInboxService } from './social-approval-inbox.service';
import { SocialApprovalsService } from './social-approvals.service';
import {
  APPROVAL_SUBJECT_OWNER_ACTIONS,
  ApprovalOwnerActionRequiredException,
} from './approval-owner-actions';

@Controller('social/approvals')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class SocialApprovalsController {
  constructor(
    private readonly approvals: SocialApprovalsService,
    private readonly inbox: SocialApprovalInboxService,
    private readonly board: SocialApprovalBoardService,
    private readonly pieceActions: SocialApprovalPieceActionsService,
    private readonly settings: SocialApprovalSettingsService,
    private readonly media: SocialApprovalMediaService,
    private readonly permissions: PlatformPermissionService,
  ) {}

  private actorUserId(ctx: RequestContext): string {
    if (!ctx.userId)
      throw new BadRequestException(
        'Usuário autenticado é obrigatório para esta ação.',
      );
    return ctx.userId;
  }
  private permissionContext(ctx: RequestContext) {
    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      userId: this.actorUserId(ctx),
      role: ctx.role ?? '',
    };
  }
  @Get() @RequirePermission('social.approvals.review.view.assigned') list(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ListSocialApprovalsDto,
  ) {
    return this.approvals.list(resolveCompanyAwareScope(ctx), query);
  }
  /**
   * CS5 Closeout — every approval the caller may operate, across the own
   * scope and the managed companies, each row with the context to act in.
   * Declared before `:id` so the literal segment is never parsed as an id.
   */
  @Get('inbox')
  @RequirePermission('social.approvals.review.view.assigned')
  inboxList(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ListSocialApprovalInboxDto,
  ) {
    return this.inbox.list(ctx, query);
  }
  /**
   * AR1 — literal routes come before `:id`, so a segment is never parsed as
   * an approval id. The board syncs Planner pieces of the contexts it reads
   * (D-31).
   */
  @Get('board')
  @RequirePermission('social.approvals.review.view.assigned')
  boardList(
    @RequestContextData() ctx: RequestContext,
    @Query() query: SocialApprovalBoardQueryDto,
  ) {
    return this.board.board(ctx, query);
  }
  @Post('board/reconcile')
  @RequirePermission('social.approvals.settings.manage')
  reconcile(@RequestContextData() ctx: RequestContext) {
    return this.board.reconcile(resolveCompanyAwareScope(ctx));
  }
  @Get('settings')
  @RequirePermission('social.approvals.settings.manage')
  getSettings(@RequestContextData() ctx: RequestContext) {
    return this.settings.get(resolveCompanyAwareScope(ctx));
  }
  @Patch('settings')
  @RequirePermission('social.approvals.settings.manage')
  updateSettings(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: UpdateSocialApprovalSettingsDto,
  ) {
    return this.settings.update(
      resolveCompanyAwareScope(ctx),
      this.actorUserId(ctx),
      dto,
    );
  }
  @Post('pieces/standalone')
  @RequirePermission('social.approvals.review.comment.assigned')
  createStandalone(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateStandalonePieceDto,
  ) {
    return this.pieceActions.createStandalone(
      resolveCompanyAwareScope(ctx),
      this.actorUserId(ctx),
      dto,
    );
  }
  @Get('pieces/:pieceId')
  @RequirePermission('social.approvals.review.view.assigned')
  async pieceDetail(
    @RequestContextData() ctx: RequestContext,
    @Param('pieceId', ParseUUIDPipe) pieceId: string,
  ) {
    const context = this.permissionContext(ctx);
    return this.board.pieceDetail(resolveCompanyAwareScope(ctx), pieceId, {
      userId: context.userId,
      role: ctx.role,
      permissions: await this.permissions.getEffectivePermissions(context),
    });
  }
  /**
   * D-15. The route key covers finishing a fully approved piece; when a step
   * is pending, the service demands the Owner key as well.
   */
  @Post('pieces/:pieceId/finish')
  @RequirePermission('social.approvals.review.approve_internal.manager')
  finish(
    @RequestContextData() ctx: RequestContext,
    @Param('pieceId', ParseUUIDPipe) pieceId: string,
    @Body() dto: FinishSocialApprovalPieceDto,
  ) {
    return this.pieceActions.finish(
      resolveCompanyAwareScope(ctx),
      pieceId,
      this.actorUserId(ctx),
      dto.reason,
      () =>
        this.permissions.assertCan(
          this.permissionContext(ctx),
          'social.approvals.review.agency_override.owner',
        ),
    );
  }
  /** Agency-side bytes of a snapshot, by opaque slot (D-29). */
  @Get('snapshots/:snapshotId/media/:mediaRef')
  @RequirePermission('social.approvals.review.view.assigned')
  async snapshotMedia(
    @RequestContextData() ctx: RequestContext,
    @Param('snapshotId', ParseUUIDPipe) snapshotId: string,
    @Param('mediaRef') mediaRef: string,
    @Res() response: Response,
  ) {
    const { file, mimeType } = await this.media.open(
      resolveCompanyAwareScope(ctx),
      snapshotId,
      mediaRef,
    );
    response.setHeader('Content-Type', mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    file.body.pipe(response);
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
  @Get(':id/text-versions')
  @RequirePermission('social.approvals.review.view.assigned')
  textVersions(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.textVersions(resolveCompanyAwareScope(ctx), id);
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
      ctx.role,
    );
  }
  @Post(':id/agency-override')
  @RequirePermission('social.approvals.review.agency_override.owner')
  agencyOverride(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.approvals.agencyOverride(
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
      ctx.role,
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
