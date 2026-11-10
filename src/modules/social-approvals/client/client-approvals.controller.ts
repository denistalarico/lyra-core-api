import { FilesInterceptor } from '@nestjs/platform-express';
import { ApprovalFeedbackDto } from '../dto/social-approval.dto';
import {
  APPROVAL_FEEDBACK_MAX_FILES,
  APPROVAL_FEEDBACK_UPLOAD,
  SocialApprovalFeedbackService,
  type ApprovalFeedbackFile,
} from '../social-approval-feedback.service';
import { clientFeedbackTargets } from './client-approval-board.view';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { FilesService } from '../../../common/files/files.service';
import {
  ClientAreaContextData,
  RequireClientAreaModule,
  RequireClientAreaPermission,
} from '../../client-area/client-area.decorators';
import { toCompanyAwareScope } from '../../client-area/client-area-scope';
import type { ClientAreaContext } from '../../client-area/client-area.types';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
  ClientAreaMembershipGuard,
} from '../../client-area/guards/client-area.guards';
import { ApprovalClientReviewService } from '../approval-client-review.service';
import { ClientApprovalBoardQueryDto } from '../dto/social-approval-piece.dto';
import { SocialApprovalPiecesService } from '../social-approval-pieces.service';
import { ClientApprovalBoardService } from './client-approval-board.service';
import { ClientApprovalMediaService } from './client-approval-media.service';
import {
  ClientApprovalCommentDto,
  ClientApprovalEditTextDto,
  ClientApprovalRequestChangesDto,
  ClientApprovalWorkItemsQueryDto,
} from './client-approval.dto';
import { ClientApprovalTextEditService } from './client-approval-text-edit.service';
import { ClientApprovalsService } from './client-approvals.service';
import {
  buildClientApprovalListItem,
  isClientApprovalMediaRef,
} from './client-approval.view';

/**
 * AP3 — the Client Area approvals boundary.
 *
 * Separate from `SocialApprovalsController` on purpose. That one authenticates
 * an Agency operator (`JwtAuthGuard` + `PermissionsGuard` + Agency permission
 * keys) and returns whole entities; this one authenticates a real client
 * person and returns a projection built field by field.
 *
 * AUTHORIZATION, IN THIS ORDER, ON EVERY ROUTE
 * --------------------------------------------
 *   ClientAreaEnabledGuard     surface flag; off ⇒ 404, not a hidden button
 *   ClientAreaAuthGuard        Client Area JWT + live session + not an operator
 *   ClientAreaMembershipGuard  membership, company, org, client, CRM chain
 *   @RequireClientAreaModule   `approvals` entitlement of the managed tenant
 *   @RequireClientAreaPermission  the role preset's key
 *
 * The company always comes from the path and is authoritative only after the
 * membership matches it; no body or header is ever consulted. The scope handed
 * to the domain is `toCompanyAwareScope(ClientAreaContext)` — never
 * `resolveCompanyAwareScope(RequestContext)`, which carries Agency operator
 * and managed-context semantics.
 *
 * The actor of every mutation is `ctx.userId` (the real person). The
 * membership is evidence of authorization and never an actor (CA0 §S).
 */
@Controller('client-area/companies/:companyContextId/approvals')
@UseGuards(
  ClientAreaEnabledGuard,
  ClientAreaAuthGuard,
  ClientAreaMembershipGuard,
)
@RequireClientAreaModule('approvals')
export class ClientAreaApprovalsController {
  constructor(
    private readonly approvals: ClientApprovalsService,
    private readonly review: ApprovalClientReviewService,
    private readonly media: ClientApprovalMediaService,
    private readonly files: FilesService,
    private readonly board: ClientApprovalBoardService,
    private readonly textEdit: ClientApprovalTextEditService,
    private readonly pieces: SocialApprovalPiecesService,
    private readonly feedback: SocialApprovalFeedbackService,
  ) {}

  private reader(context: ClientAreaContext) {
    return {
      userId: context.userId,
      permissions: {
        comment: context.permissions.has('client_area.approvals.comment'),
        decide: context.permissions.has('client_area.approvals.decide'),
        editText: context.permissions.has('client_area.approvals.edit_text'),
      },
    };
  }

  @Get()
  @RequireClientAreaPermission('client_area.approvals.view')
  list(@ClientAreaContextData() context: ClientAreaContext) {
    return this.approvals.list(toCompanyAwareScope(context));
  }

  /** AR1 — literal segments, declared before `:approvalId`. */
  @Get('board')
  @RequireClientAreaPermission('client_area.approvals.view')
  boardList(
    @ClientAreaContextData() context: ClientAreaContext,
    @Query() query: ClientApprovalBoardQueryDto,
  ) {
    return this.board.board(toCompanyAwareScope(context), query);
  }

  /** AR4 / D-06: read-only, same card as the board. */
  @Get('work-items')
  @RequireClientAreaPermission('client_area.approvals.view')
  workItems(
    @ClientAreaContextData() context: ClientAreaContext,
    @Query() query: ClientApprovalWorkItemsQueryDto,
  ) {
    return this.board.workItems(toCompanyAwareScope(context), query);
  }

  @Get('pieces/:pieceId')
  @RequireClientAreaPermission('client_area.approvals.view')
  piece(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('pieceId', ParseUUIDPipe) pieceId: string,
  ) {
    return this.board.piece(
      toCompanyAwareScope(context),
      pieceId,
      this.reader(context),
    );
  }

  /**
   * One decision over the piece. The route needs only `view`: the actions on
   * the projection already combine permission, phase and D-17, and an empty
   * target list refuses the request.
   */
  @Post('pieces/:pieceId/feedback')
  @RequireClientAreaPermission('client_area.approvals.view')
  @UseInterceptors(
    FilesInterceptor(
      'files',
      APPROVAL_FEEDBACK_MAX_FILES,
      APPROVAL_FEEDBACK_UPLOAD,
    ),
  )
  async pieceFeedback(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('pieceId', ParseUUIDPipe) pieceId: string,
    @Body() dto: ApprovalFeedbackDto,
    @UploadedFiles() files: ApprovalFeedbackFile[] = [],
  ) {
    const scope = toCompanyAwareScope(context);
    const reader = this.reader(context);
    await this.feedback.submit(
      scope,
      dto,
      files,
      clientFeedbackTargets(await this.board.piece(scope, pieceId, reader)),
      {
        approve: (id, notes) =>
          this.review.approve(scope, id, context.userId, undefined, notes),
        changes: (id, content, kind) =>
          this.review.requestChanges(
            scope,
            id,
            context.userId,
            content,
            undefined,
            kind,
          ),
        comment: (id, content) =>
          this.review.comment(scope, id, context.userId, content),
      },
    );
    return this.board.piece(scope, pieceId, reader);
  }

  /** Only attachments of comments the client can read; anything else is 404. */
  @Get(':approvalId/attachments/:attachmentId')
  @RequireClientAreaPermission('client_area.approvals.view')
  async attachment(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res() response: Response,
  ) {
    await this.approvals.findVisible(toCompanyAwareScope(context), approvalId);
    const { file, mimeType } = await this.feedback.openAttachment(
      approvalId,
      attachmentId,
      'client',
    );
    response.setHeader('Content-Type', mimeType);
    response.setHeader('Content-Disposition', 'attachment');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    file.body.pipe(response);
  }

  @Get(':approvalId')
  @RequireClientAreaPermission('client_area.approvals.view')
  detail(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    return this.approvals.detail(
      toCompanyAwareScope(context),
      approvalId,
      this.reader(context),
    );
  }

  @Get(':approvalId/preview')
  @RequireClientAreaPermission('client_area.approvals.view')
  async preview(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    return {
      preview: await this.approvals.preview(
        toCompanyAwareScope(context),
        approvalId,
      ),
    };
  }

  /**
   * §18/§19 — an explicit view record, not a side effect of `GET`. It moves no
   * status, creates no decision and approves nothing; it only stamps first/last
   * seen and the viewer, through the existing AP2 mechanism.
   */
  @Post(':approvalId/view')
  @RequireClientAreaPermission('client_area.approvals.view')
  async view(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    const scope = toCompanyAwareScope(context);
    // Proves visibility with the client rule (scope + sent phase) before the
    // domain method, whose own guard is the Agency scope tuple alone.
    await this.approvals.findVisible(scope, approvalId);
    const saved = await this.review.view(scope, approvalId, context.userId);
    return { approval: buildClientApprovalListItem(saved) };
  }

  @Post(':approvalId/comments')
  @RequireClientAreaPermission('client_area.approvals.comment')
  async comment(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Body() dto: ClientApprovalCommentDto,
  ) {
    const scope = toCompanyAwareScope(context);
    await this.approvals.findVisible(scope, approvalId);
    await this.review.comment(scope, approvalId, context.userId, dto.body);
    // The whole thread comes back projected, so the client never sees the
    // raw comment row that the domain returns.
    return this.approvals.detail(scope, approvalId, this.reader(context));
  }

  @Post(':approvalId/approve')
  @RequireClientAreaPermission('client_area.approvals.decide')
  async approve(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    const scope = toCompanyAwareScope(context);
    await this.approvals.findVisible(scope, approvalId);
    await this.review.approve(scope, approvalId, context.userId);
    return this.approvals.detail(scope, approvalId, this.reader(context));
  }

  /**
   * AR5 — the same decision, taken from the conversation card. A separate
   * route so `client_conversation` is set here by the server (D-16), and the
   * body can never claim a surface.
   */
  @Post(':approvalId/conversation/approve')
  @RequireClientAreaPermission('client_area.approvals.decide')
  async approveFromConversation(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    const scope = toCompanyAwareScope(context);
    await this.approvals.findVisible(scope, approvalId);
    await this.review.approve(
      scope,
      approvalId,
      context.userId,
      'client_conversation',
    );
    return this.approvals.detail(scope, approvalId, this.reader(context));
  }

  @Post(':approvalId/conversation/request-changes')
  @RequireClientAreaPermission('client_area.approvals.decide')
  async requestChangesFromConversation(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Body() dto: ClientApprovalRequestChangesDto,
  ) {
    const scope = toCompanyAwareScope(context);
    await this.approvals.findVisible(scope, approvalId);
    await this.review.requestChanges(
      scope,
      approvalId,
      context.userId,
      dto.body,
      'client_conversation',
    );
    return this.approvals.detail(scope, approvalId, this.reader(context));
  }

  /**
   * D-02. The answer is the detail of the request that resulted: when the text
   * changed, its `id` is a new one and the screen moves to it.
   */
  @Post(':approvalId/edit-text')
  @RequireClientAreaPermission('client_area.approvals.edit_text')
  async editText(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Body() dto: ClientApprovalEditTextDto,
  ) {
    const scope = toCompanyAwareScope(context);
    await this.approvals.findVisible(scope, approvalId);
    const finalId = await this.textEdit.edit(scope, approvalId, dto, {
      userId: context.userId,
      surface: 'client_area',
    });
    return this.approvals.detail(scope, finalId, this.reader(context));
  }

  /** R-08: only what was put in front of the client, oldest first. */
  @Get(':approvalId/text-versions')
  @RequireClientAreaPermission('client_area.approvals.view')
  async textVersions(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    const scope = toCompanyAwareScope(context);
    return this.pieces.textVersions(
      scope,
      await this.approvals.findVisible(scope, approvalId),
      'client',
    );
  }

  @Post(':approvalId/request-changes')
  @RequireClientAreaPermission('client_area.approvals.decide')
  async requestChanges(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Body() dto: ClientApprovalRequestChangesDto,
  ) {
    const scope = toCompanyAwareScope(context);
    await this.approvals.findVisible(scope, approvalId);
    await this.review.requestChanges(
      scope,
      approvalId,
      context.userId,
      dto.body,
      undefined,
      dto.kind,
    );
    return this.approvals.detail(scope, approvalId, this.reader(context));
  }

  /**
   * §26–§28 — bytes, never a location. `mediaRef` is an opaque slot name
   * ("content"/"thumbnail") resolved against this approval's immutable
   * revision; no storage key, bucket, internal host or signed URL is emitted,
   * so there is nothing to tamper with and no link that outlives the request.
   */
  @Get(':approvalId/media/:mediaRef')
  @RequireClientAreaPermission('client_area.approvals.view')
  async mediaContent(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Param('mediaRef') mediaRef: string,
    @Res() response: Response,
  ) {
    const scope = toCompanyAwareScope(context);
    if (!isClientApprovalMediaRef(mediaRef)) {
      const opened = await this.media.openSnapshot(scope, approvalId, mediaRef);
      response.setHeader('Content-Type', opened.mimeType);
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      opened.file.body.pipe(response);
      return;
    }
    const media = await this.media.resolve(scope, approvalId, mediaRef);
    const file = await this.files.getPrivateAsset(media.storagePath);
    response.setHeader('Content-Type', media.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    file.body.pipe(response);
  }

  /**
   * CA10 / R-23 — download of the deliverable: the original file of the
   * approved version, as an attachment. Opaque like `media/:mediaRef`: the
   * approval is the only handle; anything not approved is 404.
   */
  @Get(':approvalId/download')
  @RequireClientAreaPermission('client_area.approvals.view')
  async download(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Res() response: Response,
  ) {
    const { media, fileName } = await this.media.resolveDeliverable(
      toCompanyAwareScope(context),
      approvalId,
    );
    const file = await this.files.getPrivateAsset(media.storagePath);
    response.setHeader('Content-Type', media.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    file.body.pipe(response);
  }
}
