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
  ClientAreaSelfContextData,
  RequireClientAreaModule,
  RequireClientAreaPermission,
} from '../../client-area/client-area.decorators';
import type { ClientAreaSelfContext } from '../../client-area/client-area.types';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
  ClientAreaSelfContextGuard,
} from '../../client-area/guards/client-area.guards';
import { ClientApprovalBoardQueryDto } from '../dto/social-approval-piece.dto';
import {
  ClientApprovalCommentDto,
  ClientApprovalEditTextDto,
  ClientApprovalRequestChangesDto,
  ClientApprovalWorkItemsQueryDto,
} from './client-approval.dto';
import {
  selfApprovalScope,
  SelfApprovalsService,
  type SelfApprovalReader,
} from './self-approvals.service';

/**
 * D-24 — approvals of the agency's own Client Area.
 *
 * A branch of its own instead of an entry in the company Bridge: the company
 * path keeps refusing Agency decisions (`social-client-area.routes.spec.ts`),
 * and this one is unreachable without `ClientAreaSelfContextGuard`, which an
 * external client never passes. Mirrors the company routes and payloads so
 * the screen is the same; submitting, cancelling, overriding and finishing
 * stay on the Agency surface.
 */
@Controller('client-area/self/approvals')
@UseGuards(
  ClientAreaEnabledGuard,
  ClientAreaAuthGuard,
  ClientAreaSelfContextGuard,
)
@RequireClientAreaModule('approvals')
export class SelfApprovalsController {
  constructor(
    private readonly approvals: SelfApprovalsService,
    private readonly files: FilesService,
    private readonly feedback: SocialApprovalFeedbackService,
  ) {}

  private reader(context: ClientAreaSelfContext): SelfApprovalReader {
    return {
      userId: context.userId,
      agencyRole: context.agencyRole,
      permissions: {
        comment: context.permissions.has('client_area.approvals.comment'),
        decide: context.permissions.has('client_area.approvals.decide'),
        editText: context.permissions.has('client_area.approvals.edit_text'),
      },
    };
  }

  @Get()
  @RequireClientAreaPermission('client_area.approvals.view')
  list(@ClientAreaSelfContextData() context: ClientAreaSelfContext) {
    return this.approvals.list(selfApprovalScope(context));
  }

  /** Literal segments, declared before `:approvalId`. */
  @Get('board')
  @RequireClientAreaPermission('client_area.approvals.view')
  board(
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
    @Query() query: ClientApprovalBoardQueryDto,
  ) {
    return this.approvals.boardList(selfApprovalScope(context), query);
  }

  @Get('work-items')
  @RequireClientAreaPermission('client_area.approvals.view')
  workItems(
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
    @Query() query: ClientApprovalWorkItemsQueryDto,
  ) {
    return this.approvals.workItems(selfApprovalScope(context), query);
  }

  @Get('pieces/:pieceId')
  @RequireClientAreaPermission('client_area.approvals.view')
  piece(
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
    @Param('pieceId', ParseUUIDPipe) pieceId: string,
  ) {
    return this.approvals.piece(
      selfApprovalScope(context),
      pieceId,
      this.reader(context),
    );
  }

  /** One decision over the piece; `canDecide`/`canComment` pick the requests. */
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
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
    @Param('pieceId', ParseUUIDPipe) pieceId: string,
    @Body() dto: ApprovalFeedbackDto,
    @UploadedFiles() files: ApprovalFeedbackFile[] = [],
  ) {
    const scope = selfApprovalScope(context);
    const reader = this.reader(context);
    await this.feedback.submit(
      scope,
      dto,
      files,
      clientFeedbackTargets(await this.approvals.piece(scope, pieceId, reader)),
      {
        approve: (id, notes) =>
          this.approvals.approve(scope, id, reader, notes),
        changes: (id, content, kind) =>
          this.approvals.requestChanges(scope, id, reader, content, kind),
        comment: (id, content) =>
          this.approvals.comment(scope, id, reader, content),
      },
    );
    return this.approvals.piece(scope, pieceId, reader);
  }

  @Get(':approvalId/attachments/:attachmentId')
  @RequireClientAreaPermission('client_area.approvals.view')
  async attachment(
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Res() response: Response,
  ) {
    const { file, mimeType } = await this.approvals.attachment(
      selfApprovalScope(context),
      approvalId,
      attachmentId,
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
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    return this.approvals.detail(
      selfApprovalScope(context),
      approvalId,
      this.reader(context),
    );
  }

  @Get(':approvalId/preview')
  @RequireClientAreaPermission('client_area.approvals.view')
  async preview(
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    return {
      preview: await this.approvals.preview(
        selfApprovalScope(context),
        approvalId,
      ),
    };
  }

  @Post(':approvalId/view')
  @RequireClientAreaPermission('client_area.approvals.view')
  async view(
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    return {
      approval: await this.approvals.view(
        selfApprovalScope(context),
        approvalId,
        context.userId,
      ),
    };
  }

  @Post(':approvalId/comments')
  @RequireClientAreaPermission('client_area.approvals.comment')
  comment(
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Body() dto: ClientApprovalCommentDto,
  ) {
    return this.approvals.comment(
      selfApprovalScope(context),
      approvalId,
      this.reader(context),
      dto.body,
    );
  }

  @Post(':approvalId/approve')
  @RequireClientAreaPermission('client_area.approvals.decide')
  approve(
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    return this.approvals.approve(
      selfApprovalScope(context),
      approvalId,
      this.reader(context),
    );
  }

  @Post(':approvalId/edit-text')
  @RequireClientAreaPermission('client_area.approvals.edit_text')
  editText(
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Body() dto: ClientApprovalEditTextDto,
  ) {
    return this.approvals.editText(
      selfApprovalScope(context),
      approvalId,
      this.reader(context),
      dto,
    );
  }

  @Get(':approvalId/text-versions')
  @RequireClientAreaPermission('client_area.approvals.view')
  textVersions(
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    return this.approvals.textVersions(selfApprovalScope(context), approvalId);
  }

  @Post(':approvalId/request-changes')
  @RequireClientAreaPermission('client_area.approvals.decide')
  requestChanges(
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Body() dto: ClientApprovalRequestChangesDto,
  ) {
    return this.approvals.requestChanges(
      selfApprovalScope(context),
      approvalId,
      this.reader(context),
      dto.body,
      dto.kind,
    );
  }

  @Get(':approvalId/media/:mediaRef')
  @RequireClientAreaPermission('client_area.approvals.view')
  async media(
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Param('mediaRef') mediaRef: string,
    @Res() response: Response,
  ) {
    const result = await this.approvals.openMedia(
      selfApprovalScope(context),
      approvalId,
      mediaRef,
    );
    const { file, mimeType } =
      result.kind === 'opened'
        ? result.opened
        : {
            file: await this.files.getPrivateAsset(result.storagePath),
            mimeType: result.mimeType,
          };
    response.setHeader('Content-Type', mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    file.body.pipe(response);
  }

  @Get(':approvalId/download')
  @RequireClientAreaPermission('client_area.approvals.view')
  async download(
    @ClientAreaSelfContextData() context: ClientAreaSelfContext,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
    @Res() response: Response,
  ) {
    const { media, fileName } = await this.approvals.deliverable(
      selfApprovalScope(context),
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
