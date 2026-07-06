import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  DangerousAction,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { CreateInboxChannelDto } from './dto/create-inbox-channel.dto';
import { CreateInboxConversationDto } from './dto/create-inbox-conversation.dto';
import { CreateInboxMessageDto } from './dto/create-inbox-message.dto';
import { PatchInboxChannelDto } from './dto/patch-inbox-channel.dto';
import { PatchInboxConversationDto } from './dto/patch-inbox-conversation.dto';
import { InboxService, InboxConversationFilters } from './inbox.service';

type MessageReactionBody = {
  emoji?: string;
};

const INBOX_ATTACHMENT_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
};

@Controller('inbox')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class InboxController {
  constructor(private readonly inboxService: InboxService) {}

  @Get('channels')
  @RequirePermission('leadflow.channels.channel.view.client')
  listChannels(@RequestContextData() ctx: RequestContext) {
    return this.inboxService.listChannels(ctx);
  }

  @Get('forward-targets')
  @RequirePermission('leadflow.inbox.conversation.assign.client')
  listForwardTargets(@RequestContextData() ctx: RequestContext) {
    return this.inboxService.listForwardTargets(ctx);
  }

  @Post('attachments')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.reply.assigned',
    'leadflow.inbox.conversation.reply.client',
  )
  @UseInterceptors(FileInterceptor('file', INBOX_ATTACHMENT_UPLOAD_OPTIONS))
  uploadAttachment(
    @RequestContextData() ctx: RequestContext,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.inboxService.uploadAttachment(ctx, file);
  }

  @Post('channels')
  @RequirePermission('leadflow.channels.channel.create.admin')
  createChannel(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateInboxChannelDto,
  ) {
    return this.inboxService.createChannel(ctx, dto);
  }

  @Patch('channels/:id')
  @RequirePermission('leadflow.channels.channel.update.admin')
  patchChannel(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchInboxChannelDto,
  ) {
    return this.inboxService.patchChannel(ctx, id, dto);
  }

  @Get('conversations')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.view.assigned',
    'leadflow.inbox.conversation.view.client',
    'leadflow.inbox.conversation.view.all',
  )
  listConversations(
    @RequestContextData() ctx: RequestContext,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('channelId') channelId?: string,
    @Query('contactId') contactId?: string,
    @Query('assignedUserId') assignedUserId?: string,
    @Query('q') q?: string,
  ) {
    const filters: InboxConversationFilters = {
      status,
      priority,
      channelId,
      contactId,
      assignedUserId,
      q,
    };

    return this.inboxService.listConversations(ctx, filters);
  }

  @Post('conversations')
  @RequirePermission('leadflow.inbox.conversation.reply.client')
  createConversation(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateInboxConversationDto,
  ) {
    return this.inboxService.createConversation(ctx, dto);
  }

  @Get('conversations/:id')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.view.assigned',
    'leadflow.inbox.conversation.view.client',
    'leadflow.inbox.conversation.view.all',
  )
  getConversation(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.getConversation(ctx, id);
  }

  @Patch('conversations/:id')
  @RequirePermission('leadflow.inbox.conversation.assign.client')
  patchConversation(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchInboxConversationDto,
  ) {
    return this.inboxService.patchConversation(ctx, id, dto);
  }

  @Post('conversations/:id/mark-read')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.view.assigned',
    'leadflow.inbox.conversation.view.client',
  )
  markConversationRead(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.markConversationRead(ctx, id);
  }

  @Post('conversations/:id/mark-unread')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.view.assigned',
    'leadflow.inbox.conversation.view.client',
  )
  markConversationUnread(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.markConversationUnread(ctx, id);
  }

  @Post('conversations/:id/archive')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.close.assigned',
    'leadflow.inbox.conversation.close.client',
  )
  archiveConversation(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.archiveConversation(ctx, id);
  }

  @Post('conversations/:id/unarchive')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.close.assigned',
    'leadflow.inbox.conversation.close.client',
  )
  unarchiveConversation(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.unarchiveConversation(ctx, id);
  }

  @Post('conversations/:id/pin')
  @RequirePermission('leadflow.inbox.conversation.assign.client')
  toggleConversationPin(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.toggleConversationFlag(ctx, id, 'pinned');
  }

  @Post('conversations/:id/favorite')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.view.assigned',
    'leadflow.inbox.conversation.view.client',
  )
  toggleConversationFavorite(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.toggleConversationFlag(ctx, id, 'favorite');
  }

  @Post('conversations/:id/mute')
  @RequirePermission('leadflow.inbox.conversation.assign.client')
  toggleConversationMute(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.toggleConversationFlag(ctx, id, 'muted');
  }

  @Post('conversations/:id/block')
  @RequirePermission('leadflow.inbox.conversation.assign.client')
  toggleConversationBlock(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.toggleConversationFlag(ctx, id, 'blocked');
  }

  @Post('conversations/:id/assume')
  @RequirePermission('leadflow.inbox.conversation.assign.client')
  assumeConversation(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.assumeConversation(ctx, id);
  }

  @Post('conversations/:id/clear')
  @RequirePermission('leadflow.inbox.conversation.delete.owner_only')
  @DangerousAction()
  clearConversation(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.clearConversation(ctx, id);
  }

  @Delete('conversations/:id')
  @RequirePermission('leadflow.inbox.conversation.delete.owner_only')
  @DangerousAction()
  deleteConversation(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.deleteConversation(ctx, id);
  }

  @Get('conversations/:id/messages')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.view.assigned',
    'leadflow.inbox.conversation.view.client',
    'leadflow.inbox.conversation.view.all',
  )
  listMessages(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.listMessages(ctx, id);
  }

  @Post('conversations/:id/messages')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.reply.assigned',
    'leadflow.inbox.conversation.reply.client',
  )
  createMessage(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateInboxMessageDto,
  ) {
    return this.inboxService.createMessage(ctx, id, dto);
  }

  @Post('conversations/:id/messages/:messageId/reaction')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.reply.assigned',
    'leadflow.inbox.conversation.reply.client',
  )
  reactToMessage(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() body: MessageReactionBody,
  ) {
    return this.inboxService.reactToMessage(ctx, id, messageId, body.emoji);
  }

  @Post('conversations/:id/messages/:messageId/pin')
  @RequirePermission('leadflow.inbox.conversation.assign.client')
  toggleMessagePin(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.inboxService.toggleMessageFlag(ctx, id, messageId, 'pinned');
  }

  @Post('conversations/:id/messages/:messageId/favorite')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.view.assigned',
    'leadflow.inbox.conversation.view.client',
  )
  toggleMessageFavorite(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.inboxService.toggleMessageFlag(ctx, id, messageId, 'favorite');
  }

  @Delete('conversations/:id/messages/:messageId')
  @RequirePermission('leadflow.inbox.conversation.delete.owner_only')
  @DangerousAction()
  deleteMessage(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.inboxService.deleteMessage(ctx, id, messageId);
  }

  @Get('conversations/:id/events')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.view.assigned',
    'leadflow.inbox.conversation.view.client',
    'leadflow.inbox.conversation.view.all',
  )
  listEvents(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.listEvents(ctx, id);
  }
}
