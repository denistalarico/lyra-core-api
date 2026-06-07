import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import { AgencyChatMessage, AgencyChatMessageRead } from '../entities';
import { TeamChatMessageKind, TeamChatMessageStatus } from '../enums';
import { CreateTeamChatMessageDto, ListTeamChatMessagesQueryDto } from '../dto';
import { TeamChatChannelsService } from './team-chat-channels.service';

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
};

const AGENCY_CONNECTION = 'agency';

@Injectable()
export class TeamChatMessagesService {
  constructor(
    @InjectRepository(AgencyChatMessage, AGENCY_CONNECTION)
    private readonly messagesRepository: Repository<AgencyChatMessage>,
    @InjectRepository(AgencyChatMessageRead, AGENCY_CONNECTION)
    private readonly readsRepository: Repository<AgencyChatMessageRead>,
    private readonly channelsService: TeamChatChannelsService,
  ) {}

  async list(
    context: TeamChatContext,
    channelId: string,
    query: ListTeamChatMessagesQueryDto,
  ) {
    await this.channelsService.assertChannel(context, channelId);

    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 100);

    const where: Record<string, unknown> = {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      channelId,
    };

    if (query.before) {
      where.createdAt = LessThan(new Date(query.before));
    }

    const messages = await this.messagesRepository.find({
      where,
      order: {
        createdAt: 'DESC',
      },
      take: limit,
    });

    return messages.reverse();
  }

  async create(
    context: TeamChatContext,
    channelId: string,
    dto: CreateTeamChatMessageDto,
  ) {
    await this.channelsService.assertChannel(context, channelId);

    const message = this.messagesRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      channelId,
      meetingRoomId: null,
      parentMessageId: dto.parentMessageId ?? null,
      senderUserId: context.userId ?? null,
      senderTeamMemberId: null,
      externalGuestId: null,
      senderDisplayName: null,
      kind: dto.kind ?? TeamChatMessageKind.TEXT,
      status: TeamChatMessageStatus.SENT,
      body: dto.body ?? null,
      metadata: null,
      deliveredAt: new Date(),
    });

    return this.messagesRepository.save(message);
  }

  async markAsRead(context: TeamChatContext, channelId: string) {
    await this.channelsService.assertChannel(context, channelId);

    const latestMessage = await this.messagesRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        channelId,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    if (!latestMessage) {
      return {
        channelId,
        messageId: null,
        readAt: new Date(),
      };
    }

    const readAt = new Date();

    await this.readsRepository.save(
      this.readsRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        channelId,
        messageId: latestMessage.id,
        userId: context.userId ?? null,
        teamMemberId: null,
        readAt,
      }),
    );

    return {
      channelId,
      messageId: latestMessage.id,
      readAt,
    };
  }
}
