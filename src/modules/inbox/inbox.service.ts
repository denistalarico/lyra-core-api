import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import type { RequestContext } from '../../common/context/request-context.interface';
import { CreateInboxChannelDto } from './dto/create-inbox-channel.dto';
import { CreateInboxConversationDto } from './dto/create-inbox-conversation.dto';
import { CreateInboxMessageDto } from './dto/create-inbox-message.dto';
import { PatchInboxChannelDto } from './dto/patch-inbox-channel.dto';
import { PatchInboxConversationDto } from './dto/patch-inbox-conversation.dto';
import {
  AgencyWorkspaceUserEntity as WorkspaceUserEntity,
  AgencyUserProfileEntity as UserProfileEntity,
} from '../agency/entities/agency-settings.entities';
import { InboxChannelEntity } from './entities/inbox-channel.entity';
import { InboxConversationEntity } from './entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from './entities/inbox-conversation-event.entity';
import { InboxConversationParticipantEntity } from './entities/inbox-conversation-participant.entity';
import { InboxMessageEntity } from './entities/inbox-message.entity';
import { InboxMediaAssetEntity } from './entities/inbox-media-asset.entity';
import { InboxMediaDerivativeEntity } from './entities/inbox-media-derivative.entity';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { FilesService } from '../../common/files/files.service';
import { mapInboxChannel } from './mappers/inbox-channel.mapper';
import { ConversationOwnershipService } from './services/conversation-ownership.service';
import { WhatsAppOutboundService } from './channels/whatsapp/services/whatsapp-outbound.service';

export type InboxConversationFilters = {
  status?: string;
  priority?: string;
  channelId?: string;
  contactId?: string;
  assignedUserId?: string;
  q?: string;
};

type ConversationFlag = 'pinned' | 'favorite' | 'muted' | 'blocked';
type MessageFlag = 'pinned' | 'favorite';

@Injectable()
export class InboxService {
  constructor(
    @InjectRepository(InboxChannelEntity, 'agency')
    private readonly channelsRepository: Repository<InboxChannelEntity>,
    @InjectRepository(InboxConversationEntity, 'agency')
    private readonly conversationsRepository: Repository<InboxConversationEntity>,
    @InjectRepository(InboxMessageEntity, 'agency')
    private readonly messagesRepository: Repository<InboxMessageEntity>,
    @InjectRepository(InboxMediaAssetEntity, 'agency')
    private readonly mediaRepository: Repository<InboxMediaAssetEntity>,
    @InjectRepository(InboxMediaDerivativeEntity, 'agency')
    private readonly mediaDerivativesRepository: Repository<InboxMediaDerivativeEntity>,
    @InjectRepository(InboxConversationParticipantEntity, 'agency')
    private readonly participantsRepository: Repository<InboxConversationParticipantEntity>,
    @InjectRepository(InboxConversationEventEntity, 'agency')
    private readonly eventsRepository: Repository<InboxConversationEventEntity>,
    @InjectRepository(WorkspaceUserEntity, 'agency')
    private readonly workspaceUsersRepository: Repository<WorkspaceUserEntity>,
    @InjectRepository(UserProfileEntity, 'agency')
    private readonly userProfilesRepository: Repository<UserProfileEntity>,
    private readonly cryptoService: SettingsCryptoService,
    private readonly filesService: FilesService,
    private readonly ownershipService: ConversationOwnershipService,
    private readonly whatsappOutboundService: WhatsAppOutboundService,
  ) {}

  async uploadAttachment(ctx: RequestContext, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Arquivo não enviado.');
    }

    const workspaceId = this.getWorkspaceId(ctx);
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? 'bin';
    const storagePath = `tenants/${ctx.tenantId}/workspaces/${workspaceId}/inbox/attachments/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${ext}`;

    const stored = await this.filesService.uploadRawFile({
      file,
      path: storagePath,
    });

    return {
      url: stored.url,
      path: stored.path,
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  private getWorkspaceId(ctx: RequestContext) {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }

    return ctx.workspaceId;
  }

  private scope(ctx: RequestContext) {
    return {
      tenantId: ctx.tenantId,
      workspaceId: this.getWorkspaceId(ctx),
    };
  }

  private applyChannelOperationalScope(
    qb: SelectQueryBuilder<InboxChannelEntity>,
    alias = 'channel',
  ) {
    qb.andWhere(
      new Brackets((scopeQb) => {
        scopeQb
          .where(`${alias}.metadata->>'clientId' IS NULL`)
          .orWhere(`${alias}.metadata->>'operatingMode' = 'agency'`);
      }),
    );
  }

  private applyContextualChannelScope(
    qb: SelectQueryBuilder<InboxChannelEntity>,
    ctx: RequestContext,
    alias = 'channel',
  ) {
    const managedContext = ctx.managedContext;

    if (managedContext?.operatingMode === 'client') {
      qb.andWhere(`${alias}.metadata->>'clientId' = :managedClientId`, {
        managedClientId: managedContext.clientId,
      });
      return;
    }

    this.applyChannelOperationalScope(qb, alias);
  }

  private applyContextualConversationScope(
    qb: SelectQueryBuilder<InboxConversationEntity>,
    ctx: RequestContext,
  ) {
    qb.leftJoin(
      InboxChannelEntity,
      'channel',
      [
        'channel.id = conversation.channel_id',
        'channel.tenant_id = conversation.tenant_id',
        'channel.workspace_id = conversation.workspace_id',
        'channel.deleted_at IS NULL',
      ].join(' AND '),
    );

    const managedContext = ctx.managedContext;

    if (managedContext?.operatingMode === 'client') {
      qb.andWhere('channel.id IS NOT NULL');
      qb.andWhere("channel.metadata->>'clientId' = :managedClientId", {
        managedClientId: managedContext.clientId,
      });
      return;
    }

    qb.andWhere(
      new Brackets((scopeQb) => {
        scopeQb
          .where('conversation.channel_id IS NULL')
          .orWhere("channel.metadata->>'clientId' IS NULL")
          .orWhere("channel.metadata->>'operatingMode' = 'agency'");
      }),
    );
  }

  private channelMetadataForContext(
    ctx: RequestContext,
    metadata: Record<string, unknown> | undefined,
  ) {
    const managedContext = ctx.managedContext;
    const nextMetadata = { ...(metadata ?? {}) };

    if (!managedContext) {
      return nextMetadata;
    }

    nextMetadata.productKey = managedContext.productKey;
    nextMetadata.operatingMode = managedContext.operatingMode;
    nextMetadata.clientId = managedContext.clientId;
    nextMetadata.managedTenantId = managedContext.managedTenantId;

    if (managedContext.clientName !== undefined) {
      nextMetadata.clientName = managedContext.clientName;
    }

    return nextMetadata;
  }

  private async findChannelForContext(ctx: RequestContext, id: string) {
    const qb = this.channelsRepository
      .createQueryBuilder('channel')
      .where('channel.tenant_id = :tenantId', { tenantId: ctx.tenantId })
      .andWhere('channel.workspace_id = :workspaceId', {
        workspaceId: this.getWorkspaceId(ctx),
      })
      .andWhere('channel.id = :id', { id })
      .andWhere('channel.deleted_at IS NULL');

    this.applyContextualChannelScope(qb, ctx);

    const channel = await qb.getOne();

    if (!channel) {
      throw new NotFoundException('Inbox channel not found.');
    }

    return channel;
  }

  private async createEvent(
    ctx: RequestContext,
    conversationId: string,
    eventType: string,
    payload: Record<string, unknown> = {},
  ) {
    await this.eventsRepository.save(
      this.eventsRepository.create({
        ...this.scope(ctx),
        conversationId,
        eventType,
        actorType: ctx.userId ? 'user' : 'system',
        actorUserId: ctx.userId ?? null,
        payload,
      }),
    );
  }

  async listChannels(ctx: RequestContext) {
    const qb = this.channelsRepository
      .createQueryBuilder('channel')
      .where('channel.tenant_id = :tenantId', { tenantId: ctx.tenantId })
      .andWhere('channel.workspace_id = :workspaceId', {
        workspaceId: this.getWorkspaceId(ctx),
      })
      .andWhere('channel.deleted_at IS NULL')
      .orderBy('channel.createdAt', 'ASC');

    this.applyContextualChannelScope(qb, ctx);

    const channels = await qb.getMany();

    return channels.map(mapInboxChannel);
  }

  async listForwardTargets(ctx: RequestContext) {
    const users = await this.workspaceUsersRepository.find({
      where: {
        ...this.scope(ctx),
        status: 'active',
      },
      order: {
        name: 'ASC',
      },
    });
    const userIds = users
      .map((user) => user.userId)
      .filter((userId): userId is string => Boolean(userId));
    const profiles =
      userIds.length > 0
        ? await this.userProfilesRepository.find({
            where: {
              tenantId: ctx.tenantId,
              userId: In(userIds),
            },
          })
        : [];

    return users
      .filter((user) => user.userId !== ctx.userId)
      .map((user) => {
        const profile = profiles.find((item) => item.userId === user.userId);

        return {
          id: user.id,
          userId: user.userId,
          name: user.name,
          email: user.email,
          status: user.status,
          avatarUrl: profile?.avatarUrl ?? null,
        };
      });
  }

  async createChannel(ctx: RequestContext, dto: CreateInboxChannelDto) {
    const channel = this.channelsRepository.create({
      ...this.scope(ctx),
      name: dto.name.trim(),
      type: dto.type ?? 'internal',
      status: dto.status ?? 'active',
      provider: dto.provider?.trim() || null,
      externalId: dto.externalId?.trim() || null,
      externalAccountId: dto.externalAccountId?.trim() || null,
      externalPhoneNumberId: dto.externalPhoneNumberId?.trim() || null,
      externalPageId: dto.externalPageId?.trim() || null,
      accessTokenEncrypted: this.cryptoService.encrypt(dto.accessToken),
      verifyToken: dto.verifyToken?.trim() || null,
      webhookSecret: dto.webhookSecret?.trim() || null,
      defaultAssignedUserId: dto.defaultAssignedUserId ?? null,
      defaultAgentId: dto.defaultAgentId ?? null,
      aiEnabled: dto.aiEnabled ?? false,
      settings: dto.settings ?? {},
      metadata: this.channelMetadataForContext(ctx, dto.metadata),
    });

    const saved = await this.channelsRepository.save(channel);

    return mapInboxChannel(saved);
  }

  async patchChannel(
    ctx: RequestContext,
    id: string,
    dto: PatchInboxChannelDto,
  ) {
    const channel = await this.findChannelForContext(ctx, id);

    if (dto.name !== undefined) channel.name = dto.name.trim();
    if (dto.aiEnabled !== undefined) {
      if (
        dto.aiEnabled &&
        (channel.status !== 'active' ||
          channel.connectionStatus !== 'connected')
      ) {
        throw new BadRequestException(
          'AI cannot be enabled until the channel is connected and active.',
        );
      }
      channel.aiEnabled = dto.aiEnabled;
    }
    if (dto.debounceSeconds !== undefined) {
      channel.settings = {
        ...(channel.settings ?? {}),
        debounceSeconds: dto.debounceSeconds,
      };
    }

    const saved = await this.channelsRepository.save(channel);

    return mapInboxChannel(saved);
  }

  async listConversations(
    ctx: RequestContext,
    filters: InboxConversationFilters,
  ) {
    const qb = this.conversationsRepository
      .createQueryBuilder('conversation')
      .where('conversation.tenant_id = :tenantId', { tenantId: ctx.tenantId })
      .andWhere('conversation.workspace_id = :workspaceId', {
        workspaceId: this.getWorkspaceId(ctx),
      });

    this.applyContextualConversationScope(qb, ctx);

    if (filters.status) {
      qb.andWhere('conversation.status = :status', {
        status: filters.status,
      });
    }

    if (filters.priority) {
      qb.andWhere('conversation.priority = :priority', {
        priority: filters.priority,
      });
    }

    if (filters.channelId) {
      qb.andWhere('conversation.channel_id = :channelId', {
        channelId: filters.channelId,
      });
    }

    if (filters.contactId) {
      qb.andWhere('conversation.contact_id = :contactId', {
        contactId: filters.contactId,
      });
    }

    if (filters.assignedUserId) {
      qb.andWhere('conversation.assigned_user_id = :assignedUserId', {
        assignedUserId: filters.assignedUserId,
      });
    }

    if (filters.q) {
      qb.andWhere('conversation.title ILIKE :q', { q: `%${filters.q}%` });
    }

    const [items, total] = await qb
      .orderBy('conversation.lastMessageAt', 'DESC', 'NULLS LAST')
      .addOrderBy('conversation.updatedAt', 'DESC')
      .take(100)
      .getManyAndCount();

    return { items, total };
  }

  async createConversation(
    ctx: RequestContext,
    dto: CreateInboxConversationDto,
  ) {
    const now = new Date();
    const managedContext = ctx.managedContext;

    if (dto.channelId) {
      await this.findChannelForContext(ctx, dto.channelId);
    } else if (managedContext?.operatingMode === 'client') {
      throw new BadRequestException(
        'channelId is required when operating in client context.',
      );
    }

    const conversation = await this.conversationsRepository.save(
      this.conversationsRepository.create({
        ...this.scope(ctx),
        channelId: dto.channelId ?? null,
        contactId: dto.contactId ?? null,
        opportunityId: null,
        externalThreadId: dto.externalThreadId?.trim() || null,
        title: dto.title?.trim() || null,
        status: dto.status ?? 'new',
        priority: dto.priority ?? 'normal',
        assignedUserId: dto.assignedUserId ?? null,
        assignedAgentId: dto.assignedAgentId ?? null,
        source: dto.source?.trim() || 'manual',
        businessMode: dto.businessMode?.trim() || 'general',
        aiEnabled: dto.aiEnabled ?? false,
        ownershipState: dto.aiEnabled ? 'ai_active' : 'paused',
        ownershipVersion: 1,
        ownershipReason: 'conversation_created',
        ownershipChangedAt: now,
        qualificationStatus: 'pending',
        qualificationReason: null,
        metadata: dto.metadata ?? {},
      }),
    );

    await this.eventsRepository.save(
      this.eventsRepository.create({
        ...this.scope(ctx),
        conversationId: conversation.id,
        eventType: 'conversation_created',
        actorType: ctx.userId ? 'user' : 'system',
        actorUserId: ctx.userId ?? null,
        payload: {
          status: conversation.status,
          priority: conversation.priority,
          createdAt: now.toISOString(),
        },
      }),
    );

    return conversation;
  }

  async getConversation(ctx: RequestContext, id: string) {
    const qb = this.conversationsRepository
      .createQueryBuilder('conversation')
      .where('conversation.tenant_id = :tenantId', { tenantId: ctx.tenantId })
      .andWhere('conversation.workspace_id = :workspaceId', {
        workspaceId: this.getWorkspaceId(ctx),
      })
      .andWhere('conversation.id = :id', { id });

    this.applyContextualConversationScope(qb, ctx);

    const conversation = await qb.getOne();

    if (!conversation) {
      throw new NotFoundException('Inbox conversation not found.');
    }

    return conversation;
  }

  async patchConversation(
    ctx: RequestContext,
    id: string,
    dto: PatchInboxConversationDto,
  ) {
    const conversation = await this.getConversation(ctx, id);
    if (dto.aiEnabled !== undefined) {
      throw new BadRequestException(
        'Use the explicit conversation ownership actions to change AI control.',
      );
    }
    if (
      dto.status &&
      ['handoff_requested', 'closed', 'resolved'].includes(dto.status)
    ) {
      throw new BadRequestException(
        'Use the explicit handoff or close action for this status transition.',
      );
    }
    const before = {
      status: conversation.status,
      priority: conversation.priority,
      assignedUserId: conversation.assignedUserId,
    };

    if (dto.channelId !== undefined && dto.channelId !== null) {
      await this.findChannelForContext(ctx, dto.channelId);
    } else if (
      dto.channelId === null &&
      ctx.managedContext?.operatingMode === 'client'
    ) {
      throw new BadRequestException(
        'channelId cannot be cleared when operating in client context.',
      );
    }

    Object.assign(conversation, {
      channelId:
        dto.channelId !== undefined ? dto.channelId : conversation.channelId,
      contactId:
        dto.contactId !== undefined ? dto.contactId : conversation.contactId,
      externalThreadId:
        dto.externalThreadId !== undefined
          ? dto.externalThreadId?.trim() || null
          : conversation.externalThreadId,
      title:
        dto.title !== undefined
          ? dto.title?.trim() || null
          : conversation.title,
      status: dto.status ?? conversation.status,
      priority: dto.priority ?? conversation.priority,
      assignedUserId:
        dto.assignedUserId !== undefined
          ? dto.assignedUserId
          : conversation.assignedUserId,
      assignedAgentId:
        dto.assignedAgentId !== undefined
          ? dto.assignedAgentId
          : conversation.assignedAgentId,
      source: dto.source?.trim() || conversation.source,
      businessMode: dto.businessMode?.trim() || conversation.businessMode,
      aiEnabled: dto.aiEnabled ?? conversation.aiEnabled,
      metadata: dto.metadata ?? conversation.metadata,
      closedAt:
        dto.status === 'closed' || dto.status === 'resolved'
          ? new Date()
          : conversation.closedAt,
      archivedAt:
        dto.status === 'archived' ? new Date() : conversation.archivedAt,
    });

    const saved = await this.conversationsRepository.save(conversation);

    await this.eventsRepository.save(
      this.eventsRepository.create({
        ...this.scope(ctx),
        conversationId: saved.id,
        eventType: 'conversation_updated',
        actorType: ctx.userId ? 'user' : 'system',
        actorUserId: ctx.userId ?? null,
        payload: {
          before,
          after: {
            status: saved.status,
            priority: saved.priority,
            assignedUserId: saved.assignedUserId,
          },
        },
      }),
    );

    return saved;
  }

  async markConversationRead(ctx: RequestContext, id: string) {
    const conversation = await this.getConversation(ctx, id);
    conversation.unreadCount = 0;

    const saved = await this.conversationsRepository.save(conversation);

    await this.eventsRepository.save(
      this.eventsRepository.create({
        ...this.scope(ctx),
        conversationId: saved.id,
        eventType: 'conversation_marked_read',
        actorType: ctx.userId ? 'user' : 'system',
        actorUserId: ctx.userId ?? null,
        payload: {},
      }),
    );

    return saved;
  }

  async markConversationUnread(ctx: RequestContext, id: string) {
    const conversation = await this.getConversation(ctx, id);
    conversation.unreadCount = Math.max(conversation.unreadCount ?? 0, 1);
    conversation.metadata = {
      ...(conversation.metadata ?? {}),
      manuallyMarkedUnread: true,
      manuallyMarkedUnreadAt: new Date().toISOString(),
      manuallyMarkedUnreadBy: ctx.userId ?? null,
    };

    const saved = await this.conversationsRepository.save(conversation);

    await this.createEvent(ctx, saved.id, 'conversation_marked_unread');

    return saved;
  }

  async archiveConversation(ctx: RequestContext, id: string) {
    const conversation = await this.getConversation(ctx, id);
    conversation.status = 'archived';
    conversation.archivedAt = new Date();
    conversation.metadata = {
      ...(conversation.metadata ?? {}),
      archivedBy: ctx.userId ?? null,
    };

    const saved = await this.conversationsRepository.save(conversation);

    await this.createEvent(ctx, saved.id, 'conversation_archived');

    return saved;
  }

  async unarchiveConversation(ctx: RequestContext, id: string) {
    const conversation = await this.getConversation(ctx, id);
    conversation.status = 'open';
    conversation.archivedAt = null;
    conversation.metadata = {
      ...(conversation.metadata ?? {}),
      archivedBy: null,
      unarchivedBy: ctx.userId ?? null,
      unarchivedAt: new Date().toISOString(),
    };

    const saved = await this.conversationsRepository.save(conversation);

    await this.createEvent(ctx, saved.id, 'conversation_unarchived');

    return saved;
  }

  async toggleConversationFlag(
    ctx: RequestContext,
    id: string,
    flag: ConversationFlag,
  ) {
    const conversation = await this.getConversation(ctx, id);
    const metadata = conversation.metadata ?? {};
    const currentValue = metadata[flag] === true;
    const nextValue = !currentValue;
    const eventAtKey = `${flag}At`;
    const eventByKey = `${flag}By`;

    conversation.metadata = {
      ...metadata,
      [flag]: nextValue,
      [eventAtKey]: nextValue ? new Date().toISOString() : null,
      [eventByKey]: nextValue ? (ctx.userId ?? null) : null,
    };

    const saved = await this.conversationsRepository.save(conversation);

    await this.createEvent(
      ctx,
      saved.id,
      `conversation_${flag}_${nextValue ? 'enabled' : 'disabled'}`,
    );

    return saved;
  }

  async assumeConversation(ctx: RequestContext, id: string) {
    await this.getConversation(ctx, id);
    return this.ownershipService.transition(ctx, id, 'assume');
  }

  async clearConversation(ctx: RequestContext, id: string) {
    const conversation = await this.getConversation(ctx, id);

    await this.messagesRepository.delete({
      ...this.scope(ctx),
      conversationId: id,
    });

    conversation.lastMessagePreview = null;
    conversation.lastMessageAt = null;
    conversation.unreadCount = 0;
    conversation.metadata = {
      ...(conversation.metadata ?? {}),
      clearedAt: new Date().toISOString(),
      clearedBy: ctx.userId ?? null,
    };

    const saved = await this.conversationsRepository.save(conversation);

    await this.createEvent(ctx, saved.id, 'conversation_cleared');

    return saved;
  }

  async deleteConversation(ctx: RequestContext, id: string) {
    await this.getConversation(ctx, id);

    await this.messagesRepository.delete({
      ...this.scope(ctx),
      conversationId: id,
    });
    await this.participantsRepository.delete({
      ...this.scope(ctx),
      conversationId: id,
    });
    await this.eventsRepository.delete({
      ...this.scope(ctx),
      conversationId: id,
    });
    await this.conversationsRepository.delete({
      ...this.scope(ctx),
      id,
    });

    return { deleted: true, id };
  }

  async listMessages(ctx: RequestContext, conversationId: string) {
    await this.getConversation(ctx, conversationId);

    const messages = await this.messagesRepository.find({
      where: {
        ...this.scope(ctx),
        conversationId,
      },
      order: {
        occurredAt: 'ASC',
        providerSequence: 'ASC',
        id: 'ASC',
      },
      take: 200,
    });
    if (!messages.length) return messages;
    const media = await this.mediaRepository.find({
      where: {
        ...this.scope(ctx),
        messageId: In(messages.map((message) => message.id)),
      },
      order: { createdAt: 'ASC' },
    });
    const derivatives = media.length
      ? await this.mediaDerivativesRepository.find({
          where: {
            ...this.scope(ctx),
            mediaAssetId: In(media.map((asset) => asset.id)),
          },
          order: { createdAt: 'DESC' },
        })
      : [];
    const byMessage = new Map<string, InboxMediaAssetEntity[]>();
    for (const asset of media) {
      byMessage.set(asset.messageId, [
        ...(byMessage.get(asset.messageId) ?? []),
        asset,
      ]);
    }
    return messages.map((message) => ({
      ...message,
      // Mensagens outbound guardam o anexo como descriptor no próprio JSON
      // (não geram media asset). Sem este fallback o anexo sumia na leitura.
      attachments: !byMessage.has(message.id)
        ? Array.isArray(message.attachments)
          ? message.attachments
          : []
        : (byMessage.get(message.id) ?? []).map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        mimeType: asset.mimeType,
        status: asset.status,
        name: asset.safeFilename,
        derivative: (() => {
          const derivative = derivatives.find(
            (item) => item.mediaAssetId === asset.id,
          );
          return derivative
            ? {
                id: derivative.id,
                kind: derivative.kind,
                status: derivative.status,
                outcome: derivative.outcome,
                content:
                  derivative.status === 'available' ? derivative.content : null,
                language: derivative.language,
                confidence: derivative.confidence,
                errorCode:
                  derivative.status === 'failed' ? derivative.errorCode : null,
              }
            : null;
        })(),
      })),
    }));
  }

  async createMessage(
    ctx: RequestContext,
    conversationId: string,
    dto: CreateInboxMessageDto,
  ) {
    const conversation = await this.getConversation(ctx, conversationId);
    const now = new Date();

    const direction = dto.direction ?? 'outbound';
    const senderType =
      dto.senderType ?? (direction === 'internal' ? 'user' : 'user');

    const message = await this.messagesRepository.save(
      this.messagesRepository.create({
        ...this.scope(ctx),
        conversationId,
        channelId: conversation.channelId,
        contactId: conversation.contactId,
        direction,
        senderType,
        senderUserId: dto.senderUserId ?? ctx.userId ?? null,
        senderAgentId: dto.senderAgentId ?? null,
        externalMessageId: dto.externalMessageId?.trim() || null,
        idempotencyKey: null,
        messageType: dto.messageType ?? 'text',
        content: dto.content.trim(),
        status: dto.status ?? 'sent',
        attachments: dto.attachments ?? [],
        metadata: dto.metadata ?? {},
        sentAt: direction === 'outbound' ? now : null,
        deliveredAt: null,
        readAt: null,
        occurredAt: now,
        providerSequence: null,
      }),
    );

    conversation.lastMessagePreview = message.content.slice(0, 260);
    conversation.lastMessageAt = message.createdAt ?? now;
    conversation.status =
      conversation.status === 'new' ? 'open' : conversation.status;

    if (direction === 'inbound') {
      conversation.unreadCount = (conversation.unreadCount ?? 0) + 1;
    }

    await this.conversationsRepository.save(conversation);

    await this.eventsRepository.save(
      this.eventsRepository.create({
        ...this.scope(ctx),
        conversationId,
        eventType: 'message_created',
        actorType: ctx.userId ? 'user' : 'system',
        actorUserId: ctx.userId ?? null,
        payload: {
          messageId: message.id,
          direction: message.direction,
          messageType: message.messageType,
        },
      }),
    );

    return message;
  }

  private async getMessage(
    ctx: RequestContext,
    conversationId: string,
    messageId: string,
  ) {
    await this.getConversation(ctx, conversationId);

    const message = await this.messagesRepository.findOne({
      where: {
        ...this.scope(ctx),
        conversationId,
        id: messageId,
      },
    });

    if (!message) {
      throw new NotFoundException('Inbox message not found.');
    }

    return message;
  }

  async reactToMessage(
    ctx: RequestContext,
    conversationId: string,
    messageId: string,
    emoji?: string,
  ) {
    const normalizedEmoji = emoji?.trim();

    if (!normalizedEmoji) {
      throw new BadRequestException('Emoji is required.');
    }

    const message = await this.getMessage(ctx, conversationId, messageId);
    const metadata = message.metadata ?? {};
    const existingReactions = Array.isArray(metadata.reactions)
      ? metadata.reactions.filter(
          (reaction): reaction is Record<string, unknown> =>
            Boolean(reaction && typeof reaction === 'object'),
        )
      : [];
    const actorKey = ctx.userId ? `user:${ctx.userId}` : 'system';
    const currentReaction = existingReactions.find(
      (reaction) => reaction.actorKey === actorKey,
    );
    const shouldRemoveReaction =
      currentReaction?.emoji === normalizedEmoji.slice(0, 16);
    const nextReactions = shouldRemoveReaction
      ? existingReactions.filter((reaction) => reaction.actorKey !== actorKey)
      : [
          ...existingReactions.filter(
            (reaction) => reaction.actorKey !== actorKey,
          ),
          {
            actorKey,
            actorType: ctx.userId ? 'user' : 'system',
            byUserId: ctx.userId ?? null,
            emoji: normalizedEmoji.slice(0, 16),
            reactedAt: new Date().toISOString(),
          },
        ];

    // Reação nativa do canal (WhatsApp): emoji vazio remove no app do contato.
    // A entrega é best-effort — se o canal não suportar, a reação continua
    // valendo internamente, mas registramos como local para não mentir na UI.
    const conversation = await this.getConversation(ctx, conversationId);
    let reactionDelivery: 'sent' | 'local' | 'failed' = 'local';

    try {
      const delivered = await this.whatsappOutboundService.deliverReaction({
        conversation,
        message,
        emoji: shouldRemoveReaction ? '' : normalizedEmoji.slice(0, 16),
      });
      if (delivered) reactionDelivery = 'sent';
    } catch {
      reactionDelivery = 'failed';
    }

    message.metadata = {
      ...metadata,
      reaction: nextReactions.at(-1) ?? null,
      reactions: nextReactions,
      reactionDelivery,
    };

    const saved = await this.messagesRepository.save(message);

    await this.createEvent(
      ctx,
      conversationId,
      shouldRemoveReaction ? 'message_reaction_removed' : 'message_reacted',
      {
        messageId,
        emoji: normalizedEmoji.slice(0, 16),
      },
    );

    return saved;
  }

  async toggleMessageFlag(
    ctx: RequestContext,
    conversationId: string,
    messageId: string,
    flag: MessageFlag,
  ) {
    const message = await this.getMessage(ctx, conversationId, messageId);
    const metadata = message.metadata ?? {};
    const currentValue = metadata[flag] === true;
    const nextValue = !currentValue;

    message.metadata = {
      ...metadata,
      [flag]: nextValue,
      [`${flag}At`]: nextValue ? new Date().toISOString() : null,
      [`${flag}By`]: nextValue ? (ctx.userId ?? null) : null,
    };

    const saved = await this.messagesRepository.save(message);

    await this.createEvent(
      ctx,
      conversationId,
      `message_${flag}_${nextValue ? 'enabled' : 'disabled'}`,
      {
        messageId,
      },
    );

    return saved;
  }

  async deleteMessage(
    ctx: RequestContext,
    conversationId: string,
    messageId: string,
  ) {
    const message = await this.getMessage(ctx, conversationId, messageId);

    await this.messagesRepository.delete({
      ...this.scope(ctx),
      conversationId,
      id: messageId,
    });

    const latestMessage = await this.messagesRepository.findOne({
      where: {
        ...this.scope(ctx),
        conversationId,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    const conversation = await this.getConversation(ctx, conversationId);
    conversation.lastMessagePreview =
      latestMessage?.content.slice(0, 260) ?? null;
    conversation.lastMessageAt = latestMessage?.createdAt ?? null;

    await this.conversationsRepository.save(conversation);

    await this.createEvent(ctx, conversationId, 'message_deleted', {
      messageId: message.id,
    });

    return { deleted: true, id: messageId };
  }

  async listEvents(ctx: RequestContext, conversationId: string) {
    await this.getConversation(ctx, conversationId);

    return this.eventsRepository.find({
      where: {
        ...this.scope(ctx),
        conversationId,
      },
      order: {
        createdAt: 'ASC',
      },
      take: 200,
    });
  }
  async upsertConversationFromWebchat(input: {
    tenantId: string;
    workspaceId: string;
    widgetId: string;
    visitorId: string;
    conversationId: string;
    contactId?: string | null;
    status?: string;
    source?: string;
    pageUrl?: string | null;
    pageTitle?: string | null;
    referrer?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    assignedUserId?: string | null;
    assignedAgentId?: string | null;
    aiEnabled?: boolean;
    lastMessageAt?: Date | string | null;
    metadata?: Record<string, unknown>;
  }) {
    const channel = await this.ensureWebchatChannel(input);

    const existing = await this.conversationsRepository.findOne({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        externalThreadId: input.conversationId,
        source: 'webchat',
      },
    });

    const mappedStatus = this.mapWebchatStatus(input.status);
    const title = this.resolveConversationTitle({
      source: 'webchat',
      metadata: input.metadata ?? {},
      fallback: input.pageTitle,
    });

    const metadata = {
      ...(existing?.metadata ?? {}),
      ...(input.metadata ?? {}),
      sourceModule: 'webchat',
      webchatConversationId: input.conversationId,
      webchatWidgetId: input.widgetId,
      webchatVisitorId: input.visitorId,
      pageUrl: input.pageUrl ?? null,
      pageTitle: input.pageTitle ?? null,
      referrer: input.referrer ?? null,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
    };

    if (existing) {
      existing.channelId = channel.id;
      existing.contactId = input.contactId ?? existing.contactId;
      existing.title = title;
      existing.status = mappedStatus;
      existing.assignedUserId = input.assignedUserId ?? existing.assignedUserId;
      existing.assignedAgentId =
        input.assignedAgentId ?? existing.assignedAgentId;
      existing.aiEnabled = input.aiEnabled ?? existing.aiEnabled;
      existing.lastMessageAt = input.lastMessageAt
        ? new Date(input.lastMessageAt)
        : existing.lastMessageAt;
      existing.metadata = metadata;

      return this.conversationsRepository.save(existing);
    }

    const conversation = await this.conversationsRepository.save(
      this.conversationsRepository.create({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        channelId: channel.id,
        contactId: input.contactId ?? null,
        opportunityId: null,
        externalThreadId: input.conversationId,
        title,
        status: mappedStatus,
        priority: 'normal',
        assignedUserId: input.assignedUserId ?? null,
        assignedAgentId: input.assignedAgentId ?? null,
        source: 'webchat',
        businessMode: 'general',
        aiEnabled: input.aiEnabled ?? false,
        ownershipState: input.aiEnabled ? 'ai_active' : 'paused',
        ownershipVersion: 1,
        ownershipReason: 'webchat_synced',
        ownershipChangedAt: new Date(),
        qualificationStatus: 'pending',
        qualificationReason: null,
        lastMessageAt: input.lastMessageAt
          ? new Date(input.lastMessageAt)
          : null,
        metadata,
      }),
    );

    await this.eventsRepository.save(
      this.eventsRepository.create({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
        eventType: 'conversation_synced_from_webchat',
        actorType: 'system',
        actorUserId: null,
        payload: {
          sourceModule: 'webchat',
          webchatConversationId: input.conversationId,
          webchatWidgetId: input.widgetId,
          webchatVisitorId: input.visitorId,
        },
      }),
    );

    return conversation;
  }

  async createMessageFromWebchat(input: {
    tenantId: string;
    workspaceId: string;
    widgetId: string;
    visitorId?: string | null;
    conversationId: string;
    messageId: string;
    senderType: 'visitor' | 'agent' | 'ai' | 'system';
    senderUserId?: string | null;
    senderAgentId?: string | null;
    direction: 'inbound' | 'outbound';
    messageType?: string;
    content: string;
    metadata?: Record<string, unknown>;
    conversationMetadata?: Record<string, unknown>;
    createdAt?: Date | string | null;
  }) {
    const existingMessage = await this.messagesRepository.findOne({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        externalMessageId: input.messageId,
      },
    });

    if (existingMessage) {
      return existingMessage;
    }

    const conversation = await this.upsertConversationFromWebchat({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      widgetId: input.widgetId,
      visitorId: input.visitorId ?? '',
      conversationId: input.conversationId,
      lastMessageAt: input.createdAt ?? new Date(),
      metadata: input.conversationMetadata ?? {},
    });

    const direction =
      input.senderType === 'system' ? 'system' : input.direction;

    const inboxSenderType =
      input.senderType === 'visitor'
        ? 'contact'
        : input.senderType === 'ai'
          ? 'agent'
          : input.senderType === 'agent'
            ? 'user'
            : 'system';

    const message = await this.messagesRepository.save(
      this.messagesRepository.create({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
        channelId: conversation.channelId,
        contactId: conversation.contactId,
        direction,
        senderType: inboxSenderType,
        senderUserId: input.senderUserId ?? null,
        senderAgentId: input.senderAgentId ?? null,
        externalMessageId: input.messageId,
        messageType: input.messageType === 'system' ? 'event' : 'text',
        content: input.content.trim(),
        status: input.direction === 'inbound' ? 'delivered' : 'sent',
        attachments: [],
        metadata: {
          ...(input.metadata ?? {}),
          sourceModule: 'webchat',
          webchatMessageId: input.messageId,
          webchatConversationId: input.conversationId,
          webchatWidgetId: input.widgetId,
          webchatVisitorId: input.visitorId ?? null,
        },
        sentAt: input.direction === 'outbound' ? new Date() : null,
        deliveredAt: input.direction === 'inbound' ? new Date() : null,
        readAt: null,
        occurredAt: input.createdAt ?? new Date(),
        providerSequence: null,
      }),
    );

    conversation.lastMessagePreview = message.content.slice(0, 260);
    conversation.lastMessageAt = message.createdAt ?? new Date();

    if (input.direction === 'inbound') {
      conversation.unreadCount = (conversation.unreadCount ?? 0) + 1;
      conversation.status =
        conversation.status === 'new' ? 'open' : conversation.status;
    }

    await this.conversationsRepository.save(conversation);

    await this.eventsRepository.save(
      this.eventsRepository.create({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
        eventType: 'message_synced_from_webchat',
        actorType: 'system',
        actorUserId: null,
        payload: {
          sourceModule: 'webchat',
          webchatMessageId: input.messageId,
          webchatConversationId: input.conversationId,
          direction: input.direction,
          senderType: input.senderType,
        },
      }),
    );

    return message;
  }

  private async ensureWebchatChannel(input: {
    tenantId: string;
    workspaceId: string;
    widgetId: string;
  }) {
    const existing = await this.channelsRepository.findOne({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        type: 'webchat',
        provider: 'lyra_webchat',
        externalId: input.widgetId,
        deletedAt: IsNull(),
      },
    });

    if (existing) {
      return existing;
    }

    return this.channelsRepository.save(
      this.channelsRepository.create({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        name: 'Webchat',
        type: 'webchat',
        status: 'active',
        provider: 'lyra_webchat',
        externalId: input.widgetId,
        defaultAssignedUserId: null,
        defaultAgentId: null,
        aiEnabled: false,
        settings: {},
        metadata: {
          sourceModule: 'webchat',
          webchatWidgetId: input.widgetId,
        },
      }),
    );
  }

  private mapWebchatStatus(status?: string) {
    switch (status) {
      case 'active':
        return 'open';
      case 'waiting':
        return 'waiting';
      case 'handoff_requested':
        return 'handoff_requested';
      case 'resolved':
        return 'resolved';
      case 'closed':
        return 'closed';
      case 'archived':
        return 'archived';
      case 'new':
      default:
        return 'new';
    }
  }

  private resolveConversationTitle(input: {
    source?: string | null;
    metadata: Record<string, unknown>;
    fallback?: string | null;
  }) {
    const name = this.firstMetadataString(input.metadata, [
      'contactName',
      'displayName',
      'visitorName',
      'name',
      'fullName',
    ]);

    if (name) return name;

    const phone = this.firstMetadataString(input.metadata, [
      'contactPhone',
      'visitorPhone',
      'phone',
      'whatsapp',
      'waPhone',
    ]);
    const email = this.firstMetadataString(input.metadata, [
      'contactEmail',
      'visitorEmail',
      'email',
    ]);

    if (input.source === 'whatsapp' && phone) return phone;
    if (email) return email;
    if (phone) return phone;

    const ip = this.firstMetadataString(input.metadata, [
      'ip',
      'ipAddress',
      'visitorIp',
      'visitorIpAddress',
      'ipHash',
      'visitorIpHash',
    ]);

    if (ip) return ip;

    const socialHandle = this.firstMetadataString(input.metadata, [
      'handle',
      'username',
      'socialHandle',
      'instagramHandle',
      'facebookHandle',
      'messengerHandle',
      'profileUsername',
    ]);

    if (socialHandle) {
      return socialHandle.startsWith('@') ? socialHandle : `@${socialHandle}`;
    }

    return input.fallback?.trim() || 'Contato desconhecido';
  }

  private firstMetadataString(
    metadata: Record<string, unknown>,
    keys: string[],
  ) {
    for (const key of keys) {
      const value = metadata[key];

      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }

    return null;
  }
}
