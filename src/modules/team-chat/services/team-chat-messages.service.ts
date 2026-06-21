import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import {
  AgencyChatChannelMember,
  AgencyChatMessage,
  AgencyChatMessageRead,
} from '../entities';
import { TeamChatMessageKind, TeamChatMessageStatus } from '../enums';
import {
  CreateTeamChatMessageDto,
  ListTeamChatMessagesQueryDto,
  PatchTeamChatMessageDto,
  ReactToTeamChatMessageDto,
  SearchTeamChatMessagesQueryDto,
} from '../dto';
import { TeamChatChannelsService } from './team-chat-channels.service';
import { TeamChatNotificationPublisher } from './team-chat-notification.publisher';
import { TeamChatChannelKind } from '../enums';

type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
  role?: string | null;
};

const AGENCY_CONNECTION = 'agency';

function normalizeRole(role?: string | null): string {
  if (role === 'owner') return 'owner';
  if (role === 'admin' || role === 'administrator') return 'admin';
  if (role === 'manager') return 'manager';
  return 'member';
}

function isElevatedRole(role?: string | null): boolean {
  return ['owner', 'admin'].includes(normalizeRole(role));
}

@Injectable()
export class TeamChatMessagesService {
  constructor(
    @InjectRepository(AgencyChatMessage, AGENCY_CONNECTION)
    private readonly messagesRepository: Repository<AgencyChatMessage>,
    @InjectRepository(AgencyChatMessageRead, AGENCY_CONNECTION)
    private readonly readsRepository: Repository<AgencyChatMessageRead>,
    @InjectRepository(AgencyChatChannelMember, AGENCY_CONNECTION)
    private readonly membersRepository: Repository<AgencyChatChannelMember>,
    private readonly channelsService: TeamChatChannelsService,
    private readonly teamChatNotificationPublisher: TeamChatNotificationPublisher,
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
    const channel = await this.channelsService.assertChannel(context, channelId);

    const message = this.messagesRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      channelId,
      meetingRoomId: null,
      parentMessageId: dto.parentMessageId ?? null,
      senderUserId: context.userId ?? null,
      senderTeamMemberId: null,
      externalGuestId: null,
      senderDisplayName: dto.senderDisplayName ?? null,
      kind: dto.kind ?? TeamChatMessageKind.TEXT,
      status: TeamChatMessageStatus.SENT,
      body: dto.body ?? null,
      metadata: dto.metadata ?? null,
      deliveredAt: new Date(),
    });

    const saved = await this.messagesRepository.save(message);
    const mentionedUserIds = this.extractMentionedUserIds(saved.metadata);

    if (mentionedUserIds.length > 0) {
      await this.teamChatNotificationPublisher.publishUserMentioned({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        channel,
        message: saved,
        actorUserId: context.userId ?? null,
        occurredAt: saved.createdAt,
        mentionedUserIds,
      });
    }

    if (channel.kind === TeamChatChannelKind.DIRECT) {
      const members = await this.membersRepository.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          channelId,
        },
      });
      const mentionedUserIdSet = new Set(mentionedUserIds);
      const recipientUserId =
        members
          .map((member) => member.userId)
          .find(
            (userId) =>
              Boolean(userId) &&
              userId !== context.userId &&
              !mentionedUserIdSet.has(userId as string),
          ) ?? null;

      if (recipientUserId) {
        await this.teamChatNotificationPublisher.publishDirectMessageReceived({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          channel,
          message: saved,
          actorUserId: context.userId ?? null,
          occurredAt: saved.createdAt,
          recipientUserId,
        });
      }
    }

    return saved;
  }

  async patch(
    context: TeamChatContext,
    channelId: string,
    messageId: string,
    dto: PatchTeamChatMessageDto,
  ) {
    const message = await this.getMessage(context, channelId, messageId);
    this.assertOwnMessage(context, message);

    if (dto.body !== undefined) {
      message.body = dto.body?.trim() || null;
      message.status = TeamChatMessageStatus.EDITED;
      message.editedAt = new Date();
    }

    if (dto.metadata !== undefined) {
      message.metadata = {
        ...(message.metadata ?? {}),
        ...dto.metadata,
      };
    }

    return this.messagesRepository.save(message);
  }

  async remove(context: TeamChatContext, channelId: string, messageId: string) {
    const message = await this.getMessage(context, channelId, messageId);
    this.assertOwnMessage(context, message);
    message.body = null;
    message.status = TeamChatMessageStatus.DELETED;
    message.deletedAt = new Date();
    return this.messagesRepository.save(message);
  }

  async react(
    context: TeamChatContext,
    channelId: string,
    messageId: string,
    dto: ReactToTeamChatMessageDto,
  ) {
    const message = await this.getMessage(context, channelId, messageId);
    const metadata = message.metadata ?? {};
    const actorId = context.userId ?? 'anonymous';
    const existingReactionUsers =
      (metadata.reactionUsers as Record<string, string> | undefined) ?? {};
    const reactionUsers = { ...existingReactionUsers };
    const previousEmoji = reactionUsers[actorId];

    if (previousEmoji === dto.emoji) {
      delete reactionUsers[actorId];
    } else {
      reactionUsers[actorId] = dto.emoji;
    }

    const legacyReactions =
      (metadata.reactions as Record<string, number> | undefined) ?? {};
    const reactions = Object.values(reactionUsers).reduce<Record<string, number>>(
      (summary, emoji) => {
        summary[emoji] = (summary[emoji] ?? 0) + 1;
        return summary;
      },
      {},
    );

    if (Object.keys(existingReactionUsers).length === 0) {
      for (const [emoji, count] of Object.entries(legacyReactions)) {
        if (count > 0 && reactions[emoji] === undefined) reactions[emoji] = count;
      }
    }

    message.metadata = { ...metadata, reactions, reactionUsers };
    return this.messagesRepository.save(message);
  }

  async pin(
    context: TeamChatContext,
    channelId: string,
    messageId: string,
    pinned: boolean,
  ) {
    const message = await this.getMessage(context, channelId, messageId);
    message.metadata = { ...(message.metadata ?? {}), pinned };
    return this.messagesRepository.save(message);
  }

  private async getMessage(
    context: TeamChatContext,
    channelId: string,
    messageId: string,
  ) {
    await this.channelsService.assertChannel(context, channelId);
    const message = await this.messagesRepository.findOne({
      where: {
        id: messageId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        channelId,
      },
    });
    if (!message) throw new NotFoundException('Mensagem não encontrada.');
    return message;
  }

  private assertOwnMessage(context: TeamChatContext, message: AgencyChatMessage) {
    if (!context.userId || message.senderUserId !== context.userId) {
      throw new ForbiddenException('Você só pode alterar suas próprias mensagens.');
    }
  }

  private extractMentionedUserIds(
    metadata?: Record<string, unknown> | null,
  ): string[] {
    if (!metadata) {
      return [];
    }

    const candidates = [
      metadata.mentionedUserIds,
      metadata.mentionUserIds,
      metadata.mentions,
    ];
    const userIds = new Set<string>();

    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) {
        continue;
      }

      for (const item of candidate) {
        if (typeof item === 'string' && item.trim()) {
          userIds.add(item.trim());
        } else if (
          item &&
          typeof item === 'object' &&
          'userId' in item &&
          typeof item.userId === 'string' &&
          item.userId.trim()
        ) {
          userIds.add(item.userId.trim());
        }
      }
    }

    return Array.from(userIds);
  }

  async search(
    context: TeamChatContext,
    query: SearchTeamChatMessagesQueryDto,
  ) {
    const limit = Math.min(Math.max(Number(query.limit ?? 30), 1), 100);

    const builder = this.messagesRepository
      .createQueryBuilder('message')
      .where('message.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('message.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('message.deleted_at IS NULL')
      .andWhere('message.body ILIKE :search', { search: `%${query.q}%` });

    if (query.channelId) {
      builder.andWhere('message.channel_id = :channelId', {
        channelId: query.channelId,
      });
    }

    this.applySearchScope(builder, context);

    return builder.orderBy('message.created_at', 'DESC').take(limit).getMany();
  }

  private applySearchScope(
    qb: ReturnType<Repository<AgencyChatMessage>['createQueryBuilder']>,
    context: TeamChatContext,
  ) {
    if (isElevatedRole(context.role)) {
      return;
    }

    if (!context.userId) {
      qb.andWhere('1 = 0');
      return;
    }

    // TODO(permissions-sprint-9): expand manager department/client message
    // search when channel metadata is tied to department ownership.
    qb.andWhere(
      `EXISTS (
        SELECT 1
        FROM agency_chat_channel_members member_scope
        WHERE member_scope.tenant_id = message.tenant_id
          AND member_scope.workspace_id = message.workspace_id
          AND member_scope.channel_id = message.channel_id
          AND member_scope.user_id = :scopeUserId
          AND member_scope.left_at IS NULL
      )`,
      { scopeUserId: context.userId },
    );
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

    if (context.userId) {
      await this.membersRepository.update(
        {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          channelId,
          userId: context.userId,
        },
        {
          lastReadMessageId: latestMessage.id,
          lastReadAt: readAt,
        },
      );
    }

    return {
      channelId,
      messageId: latestMessage.id,
      readAt,
    };
  }
}
