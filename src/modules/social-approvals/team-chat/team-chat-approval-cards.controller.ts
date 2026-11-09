import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import type { TeamChatContext } from '../../team-chat/services/team-chat-access';
import { ClientApprovalRequestChangesDto } from '../client/client-approval.dto';
import {
  APPROVE_INTERNAL_PERMISSION,
  REQUEST_CHANGES_PERMISSION,
  TeamChatApprovalCardsService,
} from './team-chat-approval-cards.service';

/**
 * AR5 entrega 5 — the decision taken on a Team Chat card. A route of its own,
 * so the `team_chat` surface is set by the server and no body can claim it.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/team-chat/channels/:channelId/approval-cards/:messageId')
export class TeamChatApprovalCardsController {
  constructor(private readonly cards: TeamChatApprovalCardsService) {}

  private context(context: AuthorizedRequestContext): TeamChatContext {
    return {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      userId: context.userId,
      role: context.role,
    };
  }

  /** The card as this reader sees it now, for re-reads after a broadcast. */
  @Get()
  @RequirePermission('agency.chat.channels.view.assigned')
  view(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.cards.view(this.context(context), channelId, messageId);
  }

  @Post('approve')
  @RequirePermission(APPROVE_INTERNAL_PERMISSION)
  approve(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.cards.approve(this.context(context), channelId, messageId);
  }

  @Post('request-changes')
  @RequirePermission(REQUEST_CHANGES_PERMISSION)
  requestChanges(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: ClientApprovalRequestChangesDto,
  ) {
    return this.cards.requestChanges(
      this.context(context),
      channelId,
      messageId,
      dto.body,
    );
  }
}
