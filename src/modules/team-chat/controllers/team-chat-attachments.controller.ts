import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';

import { CreateTeamChatAttachmentDto } from '../dto';
import { TeamChatAttachmentsService } from '../services/team-chat-attachments.service';

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
