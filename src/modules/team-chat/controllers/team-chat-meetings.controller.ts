import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import {
  CreateTeamChatMeetingEventDto,
  JoinPublicTeamChatMeetingDto,
  JoinTeamChatMeetingDto,
  PatchTeamChatMeetingDto,
  RequestTeamChatMeetingAiSummaryDto,
} from '../dto';
import { TeamChatMeetingsService } from '../services/team-chat-meetings.service';
import {
  DangerousAction,
  RequireAnyPermission,
  RequirePermission,
} from '../../permissions';

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
};

@Controller()
export class TeamChatMeetingsController {
  constructor(private readonly meetingsService: TeamChatMeetingsService) {}

  @Post('agency/team-chat/meetings/:meetingId/start')
  @RequirePermission('agency.chat.channels.manage_members.assigned')
  startMeeting(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('meetingId') meetingId: string,
  ) {
    return this.meetingsService.startMeeting(
      this.getContext(tenantId, workspaceId, userId),
      meetingId,
    );
  }

  @Post('agency/team-chat/meetings/:meetingId/end')
  @RequirePermission('agency.chat.channels.manage_members.assigned')
  endMeeting(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('meetingId') meetingId: string,
  ) {
    return this.meetingsService.endMeeting(
      this.getContext(tenantId, workspaceId, userId),
      meetingId,
    );
  }

  @Patch('agency/team-chat/meetings/:meetingId')
  @RequirePermission('agency.chat.channels.manage_members.assigned')
  patchMeeting(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('meetingId') meetingId: string,
    @Body() dto: PatchTeamChatMeetingDto,
  ) {
    return this.meetingsService.patchMeeting(
      this.getContext(tenantId, workspaceId, userId),
      meetingId,
      dto,
    );
  }

  @Post('agency/team-chat/meetings/:meetingId/cancel')
  @RequirePermission('agency.chat.channels.manage_members.assigned')
  @DangerousAction()
  cancelMeeting(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('meetingId') meetingId: string,
  ) {
    return this.meetingsService.cancelMeeting(
      this.getContext(tenantId, workspaceId, userId),
      meetingId,
    );
  }

  @Delete('agency/team-chat/meetings/:meetingId')
  @RequirePermission('agency.chat.channels.delete.owner_only')
  @DangerousAction()
  deleteMeeting(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('meetingId') meetingId: string,
  ) {
    return this.meetingsService.deleteMeeting(
      this.getContext(tenantId, workspaceId, userId),
      meetingId,
    );
  }

  @Get('agency/team-chat/meetings/:meetingId/events')
  @RequirePermission('agency.chat.channels.view.assigned')
  listMeetingEvents(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('meetingId') meetingId: string,
  ) {
    return this.meetingsService.listEvents(
      this.getContext(tenantId, workspaceId, userId),
      meetingId,
    );
  }

  @Post('agency/team-chat/meetings/:meetingId/events')
  @RequirePermission('agency.chat.messages.send.assigned')
  createMeetingEvent(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('meetingId') meetingId: string,
    @Body() dto: CreateTeamChatMeetingEventDto,
  ) {
    return this.meetingsService.createEvent(
      this.getContext(tenantId, workspaceId, userId),
      meetingId,
      dto,
    );
  }

  @Post('agency/team-chat/meetings/:meetingId/ai-summary/request')
  @RequirePermission('agency.chat.channels.manage_members.assigned')
  requestAiSummary(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('meetingId') meetingId: string,
    @Body() dto: RequestTeamChatMeetingAiSummaryDto,
  ) {
    return this.meetingsService.requestAiSummary(
      this.getContext(tenantId, workspaceId, userId),
      meetingId,
      dto,
    );
  }

  @Post('agency/team-chat/meetings/:meetingId/join')
  @RequireAnyPermission(
    'agency.chat.channels.view.assigned',
    'agency.chat.messages.send.assigned',
  )
  joinInternalMeeting(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('meetingId') meetingId: string,
    @Body() dto: JoinTeamChatMeetingDto,
  ) {
    return this.meetingsService.joinInternal(
      this.getContext(tenantId, workspaceId, userId),
      meetingId,
      dto,
    );
  }

  @Post('public/agency/team-chat/meetings/:publicSlug/join')
  joinPublicMeeting(
    @Param('publicSlug') publicSlug: string,
    @Body() dto: JoinPublicTeamChatMeetingDto,
  ) {
    return this.meetingsService.joinPublic(publicSlug, dto);
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
