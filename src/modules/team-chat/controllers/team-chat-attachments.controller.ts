import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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

const TEAM_CHAT_ATTACHMENT_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
};

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
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
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Body() dto: CreateTeamChatAttachmentDto,
  ) {
    return this.attachmentsService.create(
      this.getContext(tenantId, workspaceId, userId),
      dto,
    );
  }

  @Get('messages/:messageId/attachments')
  @RequirePermission('agency.chat.channels.view.assigned')
  listMessageAttachments(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('messageId') messageId: string,
  ) {
    return this.attachmentsService.listByMessage(
      this.getContext(tenantId, workspaceId, userId),
      messageId,
    );
  }

  @Post('messages/:messageId/attachments')
  @RequirePermission('agency.chat.messages.send.assigned')
  @UseInterceptors(FileInterceptor('file', TEAM_CHAT_ATTACHMENT_UPLOAD_OPTIONS))
  uploadMessageAttachment(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('messageId') messageId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Arquivo não enviado.');
    return this.attachmentsService.uploadForMessage(
      this.getContext(tenantId, workspaceId, userId),
      messageId,
      file,
    );
  }

  @Delete('messages/:messageId/attachments/:attachmentId')
  @RequirePermission('agency.chat.messages.send.assigned')
  @DangerousAction()
  deleteMessageAttachment(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('messageId') messageId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.attachmentsService.deleteFromMessage(
      this.getContext(tenantId, workspaceId, userId),
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
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('meetingId') meetingId: string,
  ) {
    return this.attachmentsService.listByMeeting(
      this.getContext(tenantId, workspaceId, userId),
      meetingId,
    );
  }

  private getContext(
    tenantId: string,
    workspaceId: string,
    userId?: string,
  ): TeamChatContext {
    return {
      tenantId,
      workspaceId,
      userId: userId || null,
    };
  }
}
