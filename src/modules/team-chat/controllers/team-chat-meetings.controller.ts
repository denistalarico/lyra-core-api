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

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
};

@Controller()
export class TeamChatMeetingsController {
  constructor(private readonly meetingsService: TeamChatMeetingsService) {}

  @Post('agency/team-chat/meetings/:meetingId/start')
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
