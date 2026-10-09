import {
  Body,
  Controller,
  Delete,
  Get,
  ForbiddenException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  CreateTeamChatMeetingEventDto,
  JoinTeamChatMeetingDto,
  PatchTeamChatMeetingDto,
  RequestTeamChatMeetingAiSummaryDto,
} from '../dto';
import { TeamChatMeetingsService } from '../services/team-chat-meetings.service';
import {
  DangerousAction,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
} from '../../permissions';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
  role?: string;
};

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class TeamChatMeetingsController {
  constructor(private readonly meetingsService: TeamChatMeetingsService) {}

  @Post('agency/team-chat/meetings/:meetingId/start')
  @RequirePermission('agency.chat.channels.manage_members.assigned')
  startMeeting(
    @RequestContextData() context: RequestContext,
    @Param('meetingId') meetingId: string,
  ) {
    return this.meetingsService.startMeeting(
      this.getContext(context),
      meetingId,
    );
  }

  @Post('agency/team-chat/meetings/:meetingId/end')
  @RequirePermission('agency.chat.channels.manage_members.assigned')
  endMeeting(
    @RequestContextData() context: RequestContext,
    @Param('meetingId') meetingId: string,
  ) {
    return this.meetingsService.endMeeting(this.getContext(context), meetingId);
  }

  @Patch('agency/team-chat/meetings/:meetingId')
  @RequirePermission('agency.chat.channels.manage_members.assigned')
  patchMeeting(
    @RequestContextData() context: RequestContext,
    @Param('meetingId') meetingId: string,
    @Body() dto: PatchTeamChatMeetingDto,
  ) {
    return this.meetingsService.patchMeeting(
      this.getContext(context),
      meetingId,
      dto,
    );
  }

  @Post('agency/team-chat/meetings/:meetingId/cancel')
  @RequirePermission('agency.chat.channels.manage_members.assigned')
  @DangerousAction()
  cancelMeeting(
    @RequestContextData() context: RequestContext,
    @Param('meetingId') meetingId: string,
  ) {
    return this.meetingsService.cancelMeeting(
      this.getContext(context),
      meetingId,
    );
  }

  @Delete('agency/team-chat/meetings/:meetingId')
  @RequirePermission('agency.chat.channels.delete.owner_only')
  @DangerousAction()
  deleteMeeting(
    @RequestContextData() context: RequestContext,
    @Param('meetingId') meetingId: string,
  ) {
    return this.meetingsService.deleteMeeting(
      this.getContext(context),
      meetingId,
    );
  }

  @Get('agency/team-chat/meetings/:meetingId/events')
  @RequirePermission('agency.chat.channels.view.assigned')
  listMeetingEvents(
    @RequestContextData() context: RequestContext,
    @Param('meetingId') meetingId: string,
  ) {
    return this.meetingsService.listEvents(this.getContext(context), meetingId);
  }

  @Post('agency/team-chat/meetings/:meetingId/events')
  @RequirePermission('agency.chat.messages.send.assigned')
  createMeetingEvent(
    @RequestContextData() context: RequestContext,
    @Param('meetingId') meetingId: string,
    @Body() dto: CreateTeamChatMeetingEventDto,
  ) {
    return this.meetingsService.createEvent(
      this.getContext(context),
      meetingId,
      dto,
    );
  }

  @Post('agency/team-chat/meetings/:meetingId/ai-summary/request')
  @RequirePermission('agency.chat.channels.manage_members.assigned')
  requestAiSummary(
    @RequestContextData() context: RequestContext,
    @Param('meetingId') meetingId: string,
    @Body() dto: RequestTeamChatMeetingAiSummaryDto,
  ) {
    return this.meetingsService.requestAiSummary(
      this.getContext(context),
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
    @RequestContextData() context: RequestContext,
    @Param('meetingId') meetingId: string,
    @Body() dto: JoinTeamChatMeetingDto,
  ) {
    return this.meetingsService.joinInternal(
      this.getContext(context),
      meetingId,
      dto,
    );
  }

  private getContext(context: RequestContext): TeamChatContext {
    if (!context.tenantId || !context.workspaceId || !context.userId) {
      throw new ForbiddenException(
        'Contexto autenticado de workspace obrigatório.',
      );
    }
    return {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      userId: context.userId,
      ...(context.role ? { role: context.role } : {}),
    };
  }
}
