import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateInboxChannelDto } from './dto/create-inbox-channel.dto';
import { CreateInboxConversationDto } from './dto/create-inbox-conversation.dto';
import { CreateInboxMessageDto } from './dto/create-inbox-message.dto';
import { PatchInboxChannelDto } from './dto/patch-inbox-channel.dto';
import { PatchInboxConversationDto } from './dto/patch-inbox-conversation.dto';
import { InboxService, InboxConversationFilters } from './inbox.service';

@Controller('inbox')
@UseGuards(JwtAuthGuard)
export class InboxController {
  constructor(private readonly inboxService: InboxService) {}

  @Get('channels')
  listChannels(@RequestContextData() ctx: RequestContext) {
    return this.inboxService.listChannels(ctx);
  }

  @Post('channels')
  createChannel(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateInboxChannelDto,
  ) {
    return this.inboxService.createChannel(ctx, dto);
  }

  @Patch('channels/:id')
  patchChannel(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchInboxChannelDto,
  ) {
    return this.inboxService.patchChannel(ctx, id, dto);
  }

  @Get('conversations')
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
  createConversation(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateInboxConversationDto,
  ) {
    return this.inboxService.createConversation(ctx, dto);
  }

  @Get('conversations/:id')
  getConversation(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.getConversation(ctx, id);
  }

  @Patch('conversations/:id')
  patchConversation(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchInboxConversationDto,
  ) {
    return this.inboxService.patchConversation(ctx, id, dto);
  }

  @Post('conversations/:id/mark-read')
  markConversationRead(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.markConversationRead(ctx, id);
  }

  @Get('conversations/:id/messages')
  listMessages(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.listMessages(ctx, id);
  }

  @Post('conversations/:id/messages')
  createMessage(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateInboxMessageDto,
  ) {
    return this.inboxService.createMessage(ctx, id, dto);
  }

  @Get('conversations/:id/events')
  listEvents(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.inboxService.listEvents(ctx, id);
  }
}
