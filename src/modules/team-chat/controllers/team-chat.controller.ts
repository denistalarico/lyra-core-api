import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import {
  Body,
  Controller,
  Delete,
  Get,
  ForbiddenException,
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
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

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
  getSummary(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.channelsService.getSummary(this.getContext(context));
  }

  @Post('channels/direct')
  @RequirePermission('agency.chat.messages.send.assigned')
  findOrCreateDirectChannel(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: FindOrCreateDirectChannelDto,
  ) {
    return this.channelsService.findOrCreateDirect(
      this.getContext(context),
      dto,
    );
  }

  @Get('channels/enriched')
  @RequirePermission('agency.chat.channels.view.assigned')
  listEnrichedChannels(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query() query: ListTeamChatChannelsQueryDto,
  ) {
    return this.channelsService.listEnriched(this.getContext(context), query);
  }

  @Get('channels')
  @RequirePermission('agency.chat.channels.view.assigned')
  listChannels(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query() query: ListTeamChatChannelsQueryDto,
  ) {
    return this.channelsService.list(this.getContext(context), query);
  }

  @Post('channels')
  @RequirePermission('agency.chat.channels.create.department')
  createChannel(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateTeamChatChannelDto,
  ) {
    return this.channelsService.create(this.getContext(context), dto);
  }

  @Patch('channels/:channelId')
  @RequirePermission('agency.chat.channels.manage_members.assigned')
  patchChannel(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('channelId') channelId: string,
    @Body() dto: PatchTeamChatChannelDto,
  ) {
    return this.channelsService.patch(this.getContext(context), channelId, dto);
  }

  @Delete('channels/:channelId')
  @RequirePermission('agency.chat.channels.delete.owner_only')
  @DangerousAction()
  deleteChannel(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('channelId') channelId: string,
  ) {
    return this.channelsService.remove(this.getContext(context), channelId);
  }

  @Post('channels/:channelId/members')
  @RequirePermission('agency.chat.channels.manage_members.assigned')
  addChannelMembers(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('channelId') channelId: string,
    @Body() dto: AddTeamChatChannelMembersDto,
  ) {
    return this.channelsService.addMembers(
      this.getContext(context),
      channelId,
      dto,
    );
  }

  @Get('channels/:channelId/messages')
  @RequirePermission('agency.chat.channels.view.assigned')
  listMessages(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('channelId') channelId: string,
    @Query() query: ListTeamChatMessagesQueryDto,
  ) {
    return this.messagesService.list(
      this.getContext(context),
      channelId,
      query,
    );
  }

  @Post('channels/:channelId/messages')
  @RequirePermission('agency.chat.messages.send.assigned')
  createMessage(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('channelId') channelId: string,
    @Body() dto: CreateTeamChatMessageDto,
  ) {
    return this.messagesService.create(
      this.getContext(context),
      channelId,
      dto,
    );
  }

  @Patch('channels/:channelId/messages/:messageId')
  @RequirePermission('agency.chat.messages.send.assigned')
  patchMessage(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
    @Body() dto: PatchTeamChatMessageDto,
  ) {
    return this.messagesService.patch(
      this.getContext(context),
      channelId,
      messageId,
      dto,
    );
  }

  @Delete('channels/:channelId/messages/:messageId')
  @RequirePermission('agency.chat.messages.send.assigned')
  @DangerousAction()
  deleteMessage(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.remove(
      this.getContext(context),
      channelId,
      messageId,
    );
  }

  @Post('channels/:channelId/messages/:messageId/reactions')
  @RequirePermission('agency.chat.messages.send.assigned')
  reactToMessage(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
    @Body() dto: ReactToTeamChatMessageDto,
  ) {
    return this.messagesService.react(
      this.getContext(context),
      channelId,
      messageId,
      dto,
    );
  }

  @Post('channels/:channelId/messages/:messageId/pin')
  @RequirePermission('agency.chat.channels.manage_members.assigned')
  pinMessage(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
    @Body() dto: { pinned?: boolean },
  ) {
    return this.messagesService.pin(
      this.getContext(context),
      channelId,
      messageId,
      dto.pinned !== false,
    );
  }

  @Post('channels/:channelId/read')
  @RequirePermission('agency.chat.channels.view.assigned')
  markChannelAsRead(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('channelId') channelId: string,
  ) {
    return this.messagesService.markAsRead(this.getContext(context), channelId);
  }

  @Get('search/messages')
  @RequirePermission('agency.chat.channels.view.assigned')
  searchMessages(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query() query: SearchTeamChatMessagesQueryDto,
  ) {
    return this.messagesService.search(this.getContext(context), query);
  }

  @Patch('channels/:channelId/members/me')
  @RequirePermission('agency.chat.channels.view.assigned')
  updateMyMembership(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('channelId') channelId: string,
    @Body() dto: UpdateChannelMembershipDto,
  ) {
    return this.channelsService.updateMembership(
      this.getContext(context),
      channelId,
      dto,
    );
  }

  @Delete('channels/:channelId/members/me')
  @RequirePermission('agency.chat.channels.view.assigned')
  leaveChannel(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('channelId') channelId: string,
  ) {
    return this.channelsService.leaveChannel(
      this.getContext(context),
      channelId,
    );
  }

  @Get('settings')
  @RequirePermission('agency.chat.channels.view.assigned')
  getUserSettings(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.userSettingsService.get(this.getContext(context));
  }

  @Put('settings')
  @RequirePermission('agency.chat.channels.view.assigned')
  saveUserSettings(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: SaveTeamChatUserSettingsDto,
  ) {
    return this.userSettingsService.upsert(this.getContext(context), dto.data);
  }

  @Get('meetings')
  @RequirePermission('agency.chat.channels.view.assigned')
  listMeetings(@RequestContextData() context: RequestContext) {
    return this.meetingsService.list(this.getMeetingContext(context));
  }

  @Post('meetings')
  @RequirePermission('agency.chat.channels.create.department')
  createMeeting(
    @RequestContextData() context: RequestContext,
    @Body() dto: CreateTeamChatMeetingDto,
  ) {
    return this.meetingsService.create(this.getMeetingContext(context), dto);
  }

  @Get('meetings/:meetingId')
  @RequireAnyPermission(
    'agency.chat.channels.view.assigned',
    'agency.chat.channels.manage_members.assigned',
  )
  getMeeting(
    @RequestContextData() context: RequestContext,
    @Param('meetingId') meetingId: string,
  ) {
    return this.meetingsService.get(this.getMeetingContext(context), meetingId);
  }

  private getMeetingContext(context: RequestContext): TeamChatContext {
    if (!context.tenantId || !context.workspaceId || !context.userId)
      throw new ForbiddenException(
        'Contexto autenticado de workspace obrigatório.',
      );
    return {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      userId: context.userId,
      role: context.role,
    };
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
