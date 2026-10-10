import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { CreateTeamChatAttachmentDto } from '../dto';
import { TeamChatAttachmentsService } from '../services/team-chat-attachments.service';
import {
  DangerousAction,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
} from '../../permissions';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

const TEAM_CHAT_ATTACHMENT_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
};

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
  role?: string | null;
};

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/team-chat')
export class TeamChatAttachmentsController {
  constructor(
    private readonly attachmentsService: TeamChatAttachmentsService,
  ) {}

  @Post('attachments')
  @RequirePermission('agency.chat.messages.send.assigned')
  createAttachment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateTeamChatAttachmentDto,
  ) {
    return this.attachmentsService.create(this.getContext(context), dto);
  }

  @Get('messages/:messageId/attachments')
  @RequirePermission('agency.chat.channels.view.assigned')
  listMessageAttachments(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('messageId') messageId: string,
  ) {
    return this.attachmentsService.listByMessage(
      this.getContext(context),
      messageId,
    );
  }

  @Post('messages/:messageId/attachments')
  @RequirePermission('agency.chat.messages.send.assigned')
  @UseInterceptors(FileInterceptor('file', TEAM_CHAT_ATTACHMENT_UPLOAD_OPTIONS))
  uploadMessageAttachment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('messageId') messageId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Arquivo não enviado.');
    return this.attachmentsService.uploadForMessage(
      this.getContext(context),
      messageId,
      file,
    );
  }

  @Delete('messages/:messageId/attachments/:attachmentId')
  @RequirePermission('agency.chat.messages.send.assigned')
  @DangerousAction()
  deleteMessageAttachment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('messageId') messageId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.attachmentsService.deleteFromMessage(
      this.getContext(context),
      messageId,
      attachmentId,
    );
  }

  @Get('meetings/:meetingId/attachments')
  @RequireAnyPermission(
    'agency.chat.channels.view.assigned',
    'agency.chat.channels.manage_members.assigned',
  )
  listMeetingAttachments(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('meetingId') meetingId: string,
  ) {
    return this.attachmentsService.listByMeeting(
      this.getContext(context),
      meetingId,
    );
  }

  /**
   * SEC-A1: identity and role come from the authorized token context (live
   * membership role), never from `x-user-id`/`x-user-role`/`x-role`.
   */
  private getContext(context: AuthorizedRequestContext): TeamChatContext {
    return {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      userId: context.userId,
      role: context.role,
    };
  }
}
