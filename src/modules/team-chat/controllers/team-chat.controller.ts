import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import {
  CreateTeamChatChannelDto,
  CreateTeamChatMeetingDto,
  CreateTeamChatMessageDto,
  ListTeamChatChannelsQueryDto,
  ListTeamChatMessagesQueryDto,
} from '../dto';
import { TeamChatChannelsService } from '../services/team-chat-channels.service';
import { TeamChatMessagesService } from '../services/team-chat-messages.service';
import { TeamChatMeetingsService } from '../services/team-chat-meetings.service';

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
};

@Controller('agency/team-chat')
export class TeamChatController {
  constructor(
    private readonly channelsService: TeamChatChannelsService,
    private readonly messagesService: TeamChatMessagesService,
    private readonly meetingsService: TeamChatMeetingsService,
  ) {}

  @Get('summary')
  getSummary(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId?: string,
  ) {
    return this.channelsService.getSummary(
      this.getContext(tenantId, workspaceId, userId),
    );
  }

  @Get('channels')
  listChannels(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Query() query: ListTeamChatChannelsQueryDto,
  ) {
    return this.channelsService.list(
      this.getContext(tenantId, workspaceId, userId),
      query,
    );
  }

  @Post('channels')
  createChannel(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Body() dto: CreateTeamChatChannelDto,
  ) {
    return this.channelsService.create(
      this.getContext(tenantId, workspaceId, userId),
      dto,
    );
  }

  @Get('channels/:channelId/messages')
  listMessages(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('channelId') channelId: string,
    @Query() query: ListTeamChatMessagesQueryDto,
  ) {
    return this.messagesService.list(
      this.getContext(tenantId, workspaceId, userId),
      channelId,
      query,
    );
  }

  @Post('channels/:channelId/messages')
  createMessage(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('channelId') channelId: string,
    @Body() dto: CreateTeamChatMessageDto,
  ) {
    return this.messagesService.create(
      this.getContext(tenantId, workspaceId, userId),
      channelId,
      dto,
    );
  }

  @Post('channels/:channelId/read')
  markChannelAsRead(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('channelId') channelId: string,
  ) {
    return this.messagesService.markAsRead(
      this.getContext(tenantId, workspaceId, userId),
      channelId,
    );
  }

  @Get('meetings')
  listMeetings(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId?: string,
  ) {
    return this.meetingsService.list(
      this.getContext(tenantId, workspaceId, userId),
    );
  }

  @Post('meetings')
  createMeeting(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Body() dto: CreateTeamChatMeetingDto,
  ) {
    return this.meetingsService.create(
      this.getContext(tenantId, workspaceId, userId),
      dto,
    );
  }

  @Get('meetings/:meetingId')
  getMeeting(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('meetingId') meetingId: string,
  ) {
    return this.meetingsService.get(
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
