import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import {
  AgencyChatChannelMember,
  AgencyChatMessage,
  AgencyChatMessageRead,
} from '../entities';
import {
  TeamChatChannelStatus,
  TeamChatMessageKind,
  TeamChatMessageStatus,
} from '../enums';
import {
  CreateTeamChatMessageDto,
  ListTeamChatMessagesQueryDto,
  PatchTeamChatMessageDto,
  ReactToTeamChatMessageDto,
  SearchTeamChatMessagesQueryDto,
} from '../dto';
import { AssetAccessService } from '../../../common/files/asset-access.service';
import { authorizeMessageMetadata } from './team-chat-attachment-urls';
import { TeamChatChannelsService } from './team-chat-channels.service';
import { TeamChatNotificationPublisher } from './team-chat-notification.publisher';
import { TeamChatChannelKind, TeamChatChannelVisibility } from '../enums';
import { isElevatedRole, type TeamChatContext } from './team-chat-access';

const AGENCY_CONNECTION = 'agency';

@Injectable()
export class TeamChatMessagesService {
  private readonly logger = new Logger(TeamChatMessagesService.name);

  constructor(
    @InjectRepository(AgencyChatMessage, AGENCY_CONNECTION)
    private readonly messagesRepository: Repository<AgencyChatMessage>,
    @InjectRepository(AgencyChatMessageRead, AGENCY_CONNECTION)
    private readonly readsRepository: Repository<AgencyChatMessageRead>,
    @InjectRepository(AgencyChatChannelMember, AGENCY_CONNECTION)
    private readonly membersRepository: Repository<AgencyChatChannelMember>,
    private readonly channelsService: TeamChatChannelsService,
    private readonly teamChatNotificationPublisher: TeamChatNotificationPublisher,
    private readonly assetAccess: AssetAccessService,
  ) {}

  /**
   * Appends a fresh, viewer-bound grant to any attachment URL the message
   * carries (§25–§28). Applied on every read path, since a grant expires and so
   * cannot be stored.
   */
  private authorizeMessage(
    message: AgencyChatMessage,
    viewerUserId: string | null | undefined,
  ): AgencyChatMessage {
    const metadata = authorizeMessageMetadata(
      this.assetAccess,
      message.metadata,
      viewerUserId,
    );

    if (metadata === message.metadata) {
      return message;
    }

    // A shallow copy, so the entity the repository handed back is not mutated:
    // the grant is a per-response detail and must not leak into anything that
    // later saves this row.
    return { ...message, metadata };
  }

  async list(
    context: TeamChatContext,
    channelId: string,
    query: ListTeamChatMessagesQueryDto,
  ) {
    await this.channelsService.assertChannelAccess(
      context,
      channelId,
      'messages.list',
    );

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

    return messages
      .reverse()
      .map((message) => this.authorizeMessage(message, context.userId));
  }

  async create(
    context: TeamChatContext,
    channelId: string,
    dto: CreateTeamChatMessageDto,
  ) {
    const channel = await this.channelsService.assertChannelAccess(
      context,
      channelId,
      'messages.create',
    );

    if (channel.status !== TeamChatChannelStatus.ACTIVE) {
      throw new ForbiddenException(
        'Este canal está arquivado e não aceita novas mensagens.',
      );
    }

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
    const mentionedUserIds = await this.resolveNotifiableMentions(
      context,
      channel,
      this.extractMentionedUserIds(saved.metadata),
    );

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

    return this.authorizeMessage(saved, context.userId);
  }

  async patch(
    context: TeamChatContext,
    channelId: string,
    messageId: string,
    dto: PatchTeamChatMessageDto,
  ) {
    const message = await this.getMessage(
      context,
      channelId,
      messageId,
      'messages.patch',
    );
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

    const saved = await this.messagesRepository.save(message);
    return this.authorizeMessage(saved, context.userId);
  }

  async remove(context: TeamChatContext, channelId: string, messageId: string) {
    const message = await this.getMessage(
      context,
      channelId,
      messageId,
      'messages.remove',
    );
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
    const message = await this.getMessage(
      context,
      channelId,
      messageId,
      'messages.react',
    );
    const metadata = message.metadata ?? {};

    // The reacting actor is always the authenticated user. The former
    // `?? 'anonymous'` fallback let an unauthenticated context own a shared
    // bucket of reactions that nobody could attribute or undo (§19).
    if (!context.userId) {
      throw new ForbiddenException('Usuário não autenticado.');
    }

    const actorId = context.userId;
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
    const message = await this.getMessage(
      context,
      channelId,
      messageId,
      'messages.pin',
    );
    message.metadata = { ...(message.metadata ?? {}), pinned };
    return this.messagesRepository.save(message);
  }

  private async getMessage(
    context: TeamChatContext,
    channelId: string,
    messageId: string,
    action: string,
  ) {
    await this.channelsService.assertChannelAccess(context, channelId, action);
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

  /**
   * Narrows client-supplied mentions to the identities that may actually be
   * notified (§21).
   *
   * `metadata.mentionedUserIds` is client data: before CCOM0.5 it drove
   * `publishUserMentioned` directly, so any UUID could be sent a notification
   * naming a channel the recipient could not open, and the mention itself
   * leaked the channel's existence and subject line.
   *
   * Two filters, both fail-closed:
   *
   * 1. the mentioned id must be an active user of this workspace;
   * 2. on a non-workspace-visible channel it must also be an active
   *    participant — mentioning someone into a private channel must not notify
   *    them about a conversation they cannot read.
   *
   * Ineligible ids are dropped silently rather than rejecting the message: the
   * text is already legitimate, and a stale mention in a draft should not cost
   * the author their message.
   */
  private async resolveNotifiableMentions(
    context: TeamChatContext,
    channel: { id: string; visibility: TeamChatChannelVisibility },
    mentionedUserIds: string[],
  ): Promise<string[]> {
    if (mentionedUserIds.length === 0) {
      return [];
    }

    const eligible = await this.channelsService.resolveActiveWorkspaceUserIds(
      context,
      mentionedUserIds,
    );

    let allowed = mentionedUserIds.filter((userId) => eligible.has(userId));

    if (channel.visibility !== TeamChatChannelVisibility.WORKSPACE) {
      const participants =
        await this.channelsService.getActiveParticipantUserIds(
          context,
          channel.id,
        );
      allowed = allowed.filter((userId) => participants.has(userId));
    }

    const dropped = mentionedUserIds.length - allowed.length;

    if (dropped > 0) {
      this.logger.warn(
        `Team Chat dropped ${dropped} ineligible mention(s): ` +
          `action=messages.create channelId=${channel.id} ` +
          `actorUserId=${context.userId ?? 'anonymous'} ` +
          `tenantId=${context.tenantId} workspaceId=${context.workspaceId}`,
      );
    }

    return allowed;
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

    const results = await builder
      .orderBy('message.created_at', 'DESC')
      .take(limit)
      .getMany();

    return results.map((message) =>
      this.authorizeMessage(message, context.userId),
    );
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
    await this.channelsService.assertChannelAccess(
      context,
      channelId,
      'messages.mark_read',
    );

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

    /**
     * `agency_chat_channel_members.last_read_at` is the canonical read state —
     * it is what `countUnreadMessages()` reads and the only source of the unread
     * badge (§30).
     *
     * `agency_chat_message_reads` is an append-only audit trail that no counter
     * consults. CCOM0.5 keeps the write (option C: documented, not removed)
     * because dropping it would be a silent data-retention change for rows
     * already in production, and removing the table needs a migration this
     * sprint does not want. It must not be revived as a second source of truth
     * about unread; CCOM1's client conversation uses the watermark only.
     */
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
