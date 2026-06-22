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
  UseGuards,
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
import {
  DangerousAction,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
} from '../../permissions';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
  role?: string | null;
};

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/team-chat')
export class TeamChatController {
  constructor(
    private readonly channelsService: TeamChatChannelsService,
    private readonly messagesService: TeamChatMessagesService,
    private readonly meetingsService: TeamChatMeetingsService,
    private readonly userSettingsService: TeamChatUserSettingsService,
  ) {}

  @Get('summary')
  @RequirePermission('agency.chat.channels.view.assigned')
  getSummary(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-user-role') userRole?: string,
    @Headers('x-role') role?: string,
  ) {
    return this.channelsService.getSummary(
      this.getContext(tenantId, workspaceId, userId, userRole ?? role),
    );
  }

  @Post('channels/direct')
  @RequirePermission('agency.chat.messages.send.assigned')
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
  @RequirePermission('agency.chat.channels.view.assigned')
  listEnrichedChannels(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-user-role') userRole: string | undefined,
    @Headers('x-role') role: string | undefined,
    @Query() query: ListTeamChatChannelsQueryDto,
  ) {
    return this.channelsService.listEnriched(
      this.getContext(tenantId, workspaceId, userId, userRole ?? role),
      query,
    );
  }

  @Get('channels')
  @RequirePermission('agency.chat.channels.view.assigned')
  listChannels(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-user-role') userRole: string | undefined,
    @Headers('x-role') role: string | undefined,
    @Query() query: ListTeamChatChannelsQueryDto,
  ) {
    return this.channelsService.list(
      this.getContext(tenantId, workspaceId, userId, userRole ?? role),
      query,
    );
  }

  @Post('channels')
  @RequirePermission('agency.chat.channels.create.department')
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
  @RequirePermission('agency.chat.channels.manage_members.assigned')
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
  @RequirePermission('agency.chat.channels.delete.owner_only')
  @DangerousAction()
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
  @RequirePermission('agency.chat.channels.manage_members.assigned')
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
  @RequirePermission('agency.chat.channels.view.assigned')
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
  @RequirePermission('agency.chat.messages.send.assigned')
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
  @RequirePermission('agency.chat.messages.send.assigned')
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
  @RequirePermission('agency.chat.messages.send.assigned')
  @DangerousAction()
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
  @RequirePermission('agency.chat.messages.send.assigned')
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
  @RequirePermission('agency.chat.channels.manage_members.assigned')
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
  @RequirePermission('agency.chat.channels.view.assigned')
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
  @RequirePermission('agency.chat.channels.view.assigned')
  searchMessages(
    @Headers('x-tenant-id') tenantId: string,
    @Headers('x-workspace-id') workspaceId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-user-role') userRole: string | undefined,
    @Headers('x-role') role: string | undefined,
    @Query() query: SearchTeamChatMessagesQueryDto,
  ) {
    return this.messagesService.search(
      this.getContext(tenantId, workspaceId, userId, userRole ?? role),
      query,
    );
  }

  @Patch('channels/:channelId/members/me')
  @RequirePermission('agency.chat.channels.view.assigned')
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
  @RequirePermission('agency.chat.channels.view.assigned')
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
  @RequirePermission('agency.chat.channels.view.assigned')
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
  @RequirePermission('agency.chat.channels.view.assigned')
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
  @RequirePermission('agency.chat.channels.view.assigned')
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
  @RequirePermission('agency.chat.channels.create.department')
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
  @RequireAnyPermission(
    'agency.chat.channels.view.assigned',
    'agency.chat.channels.manage_members.assigned',
  )
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
    role?: string,
  ): TeamChatContext {
    return {
      tenantId,
      workspaceId,
      userId: userId || null,
      role: role ?? 'member',
    };
  }
}
