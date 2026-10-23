import { ClientAreaExposed } from '../../client-area/client-area.decorators';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  DangerousAction,
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../../permissions';
import {
  ListInboxCommentsQueryDto,
  ReplyInboxCommentDto,
  SetInboxCommentStatusDto,
} from '../dto/inbox-comments.dto';
import { InboxCommentService } from './inbox-comment.service';

/**
 * Post and ad comments of the LeadFlow Inbox (IX3, D-IX-5).
 *
 * Seeing, answering (public or private) and hiding are `comment.view|reply`,
 * held by every Inbox role — a comment has no assignment. Deleting is
 * irreversible on Meta: Owner/Admin only and audited (D-IX-11). The service
 * proves the company scope; a comment outside it is a 404.
 *
 * Exposed to the Client Area (Inbox parity, decision of 2026-10-23): the
 * bridge proves each comment by its `inbox_comments` company row. The delete
 * reaches the Client Area only for the company's Owner (`client_owner`).
 *
 * The route parameter is `:commentId`, not `:id`: the Inbox scope evaluator
 * reads `params.id` as a conversation id and would refuse a comment id.
 */
@Controller('inbox/comments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class InboxCommentsController {
  constructor(private readonly comments: InboxCommentService) {}

  @ClientAreaExposed('leadflow_inbox')
  @Get()
  @RequirePermission('leadflow.inbox.comment.view.client')
  list(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ListInboxCommentsQueryDto,
  ) {
    return this.comments.list(ctx, query);
  }

  @ClientAreaExposed('leadflow_inbox')
  @Get(':commentId')
  @RequirePermission('leadflow.inbox.comment.view.client')
  get(
    @RequestContextData() ctx: RequestContext,
    @Param('commentId', ParseUUIDPipe) id: string,
  ) {
    return this.comments.getThread(ctx, id);
  }

  @ClientAreaExposed('leadflow_inbox')
  @Post(':commentId/reply')
  @RequirePermission('leadflow.inbox.comment.reply.client')
  async reply(
    @RequestContextData() ctx: RequestContext,
    @Param('commentId', ParseUUIDPipe) id: string,
    @Body() dto: ReplyInboxCommentDto,
  ) {
    const actor = { type: 'user' as const, userId: ctx.userId ?? null };
    const result =
      dto.mode === 'private'
        ? await this.comments.replyPrivate(
            ctx,
            id,
            dto.text,
            dto.idempotencyKey,
            actor,
          )
        : await this.comments.replyPublic(
            ctx,
            id,
            dto.text,
            dto.idempotencyKey,
            actor,
          );
    // The reply as a comment item; a replayed key returns the same reply.
    return this.comments.present(result.comment);
  }

  @ClientAreaExposed('leadflow_inbox')
  @Post(':commentId/hide')
  @HttpCode(200)
  @RequirePermission('leadflow.inbox.comment.reply.client')
  async hide(
    @RequestContextData() ctx: RequestContext,
    @Param('commentId', ParseUUIDPipe) id: string,
  ) {
    return this.comments.present(await this.comments.setHidden(ctx, id, true));
  }

  @ClientAreaExposed('leadflow_inbox')
  @Post(':commentId/unhide')
  @HttpCode(200)
  @RequirePermission('leadflow.inbox.comment.reply.client')
  async unhide(
    @RequestContextData() ctx: RequestContext,
    @Param('commentId', ParseUUIDPipe) id: string,
  ) {
    return this.comments.present(await this.comments.setHidden(ctx, id, false));
  }

  // Client Area: Danger Zone routes pass the guard only for the company's
  // Owner (`client_owner`), audited; CA7 pins this route as the exception.
  @ClientAreaExposed('leadflow_inbox')
  @Delete(':commentId')
  @RequirePermission('leadflow.inbox.comment.delete.admin')
  @DangerousAction()
  async remove(
    @RequestContextData() ctx: RequestContext,
    @Param('commentId', ParseUUIDPipe) id: string,
  ) {
    return this.comments.present(await this.comments.remove(ctx, id));
  }

  @ClientAreaExposed('leadflow_inbox')
  @Post(':commentId/status')
  @HttpCode(200)
  @RequirePermission('leadflow.inbox.comment.reply.client')
  async setStatus(
    @RequestContextData() ctx: RequestContext,
    @Param('commentId', ParseUUIDPipe) id: string,
    @Body() dto: SetInboxCommentStatusDto,
  ) {
    return this.comments.present(
      await this.comments.setReplyStatus(ctx, id, dto.replyStatus),
    );
  }
}
