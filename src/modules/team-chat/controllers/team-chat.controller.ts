import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import {
  AddTeamChatChannelMembersDto,
  CreateTeamChatChannelDto,
  CreateTeamChatMeetingDto,
  CreateTeamChatMessageDto,
  FindOrCreateDirectChannelDto,
  ListTeamChatChannelsQueryDto,
  ListTeamChatMessagesQueryDto,
  PatchTeamChatChannelDto,
  PatchTeamChatMessageDto,
  ReactToTeamChatMessageDto,
  SaveTeamChatUserSettingsDto,
  SearchTeamChatMessagesQueryDto,
  UpdateChannelMembershipDto,
} from '../dto';
import { TeamChatChannelsService } from '../services/team-chat-channels.service';
import { TeamChatMessagesService } from '../services/team-chat-messages.service';
import { TeamChatMeetingsService } from '../services/team-chat-meetings.service';
import { TeamChatUserSettingsService } from '../services/team-chat-user-settings.service';

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
    private readonly userSettingsService: TeamChatUserSettingsService,
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

  @Post('channels/direct')
  findOrCreateDirectChannel(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Body() dto: FindOrCreateDirectChannelDto,
  ) {
    return this.channelsService.findOrCreateDirect(
      this.getContext(tenantId, workspaceId, userId),
      dto,
    );
  }

  @Get('channels/enriched')
  listEnrichedChannels(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Query() query: ListTeamChatChannelsQueryDto,
  ) {
    return this.channelsService.listEnriched(
      this.getContext(tenantId, workspaceId, userId),
      query,
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

  @Patch('channels/:channelId')
  patchChannel(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('channelId') channelId: string,
    @Body() dto: PatchTeamChatChannelDto,
  ) {
    return this.channelsService.patch(
      this.getContext(tenantId, workspaceId, userId),
      channelId,
      dto,
    );
  }

  @Delete('channels/:channelId')
  deleteChannel(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('channelId') channelId: string,
  ) {
    return this.channelsService.remove(
      this.getContext(tenantId, workspaceId, userId),
      channelId,
    );
  }

  @Post('channels/:channelId/members')
  addChannelMembers(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('channelId') channelId: string,
    @Body() dto: AddTeamChatChannelMembersDto,
  ) {
    return this.channelsService.addMembers(
      this.getContext(tenantId, workspaceId, userId),
      channelId,
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

  @Patch('channels/:channelId/messages/:messageId')
  patchMessage(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
    @Body() dto: PatchTeamChatMessageDto,
  ) {
    return this.messagesService.patch(
      this.getContext(tenantId, workspaceId, userId),
      channelId,
      messageId,
      dto,
    );
  }

  @Delete('channels/:channelId/messages/:messageId')
  deleteMessage(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.remove(
      this.getContext(tenantId, workspaceId, userId),
      channelId,
      messageId,
    );
  }

  @Post('channels/:channelId/messages/:messageId/reactions')
  reactToMessage(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
    @Body() dto: ReactToTeamChatMessageDto,
  ) {
    return this.messagesService.react(
      this.getContext(tenantId, workspaceId, userId),
      channelId,
      messageId,
      dto,
    );
  }

  @Post('channels/:channelId/messages/:messageId/pin')
  pinMessage(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
    @Body() dto: { pinned?: boolean },
  ) {
    return this.messagesService.pin(
      this.getContext(tenantId, workspaceId, userId),
      channelId,
      messageId,
      dto.pinned !== false,
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

  @Get('search/messages')
  searchMessages(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Query() query: SearchTeamChatMessagesQueryDto,
  ) {
    return this.messagesService.search(
      this.getContext(tenantId, workspaceId, userId),
      query,
    );
  }

  @Patch('channels/:channelId/members/me')
  updateMyMembership(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('channelId') channelId: string,
    @Body() dto: UpdateChannelMembershipDto,
  ) {
    return this.channelsService.updateMembership(
      this.getContext(tenantId, workspaceId, userId),
      channelId,
      dto,
    );
  }

  @Delete('channels/:channelId/members/me')
  leaveChannel(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Param('channelId') channelId: string,
  ) {
    return this.channelsService.leaveChannel(
      this.getContext(tenantId, workspaceId, userId),
      channelId,
    );
  }

  @Get('settings')
  getUserSettings(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
  ) {
    return this.userSettingsService.get(
      this.getContext(tenantId, workspaceId, userId),
    );
  }

  @Put('settings')
  saveUserSettings(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Body() dto: SaveTeamChatUserSettingsDto,
  ) {
    return this.userSettingsService.upsert(
      this.getContext(tenantId, workspaceId, userId),
      dto.data,
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
