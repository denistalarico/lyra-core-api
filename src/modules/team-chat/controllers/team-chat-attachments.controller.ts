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
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { CreateTeamChatAttachmentDto } from '../dto';
import { TeamChatAttachmentsService } from '../services/team-chat-attachments.service';

const TEAM_CHAT_ATTACHMENT_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
};

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
};

@Controller('agency/team-chat')
export class TeamChatAttachmentsController {
  constructor(private readonly attachmentsService: TeamChatAttachmentsService) {}

  @Post('attachments')
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
