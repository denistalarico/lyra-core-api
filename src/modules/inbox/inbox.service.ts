import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, IsNull, Repository } from 'typeorm';
import type { RequestContext } from '../../common/context/request-context.interface';
import { CreateInboxChannelDto } from './dto/create-inbox-channel.dto';
import { CreateInboxConversationDto } from './dto/create-inbox-conversation.dto';
import { CreateInboxMessageDto } from './dto/create-inbox-message.dto';
import { PatchInboxChannelDto } from './dto/patch-inbox-channel.dto';
import { PatchInboxConversationDto } from './dto/patch-inbox-conversation.dto';
import { InboxChannelEntity } from './entities/inbox-channel.entity';
import { InboxConversationEntity } from './entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from './entities/inbox-conversation-event.entity';
import { InboxConversationParticipantEntity } from './entities/inbox-conversation-participant.entity';
import { InboxMessageEntity } from './entities/inbox-message.entity';

export type InboxConversationFilters = {
  status?: string;
  priority?: string;
  channelId?: string;
  contactId?: string;
  assignedUserId?: string;
  q?: string;
};

@Injectable()
export class InboxService {
  constructor(
    @InjectRepository(InboxChannelEntity)
    private readonly channelsRepository: Repository<InboxChannelEntity>,
    @InjectRepository(InboxConversationEntity)
    private readonly conversationsRepository: Repository<InboxConversationEntity>,
    @InjectRepository(InboxMessageEntity)
    private readonly messagesRepository: Repository<InboxMessageEntity>,
    @InjectRepository(InboxConversationParticipantEntity)
    private readonly participantsRepository: Repository<InboxConversationParticipantEntity>,
    @InjectRepository(InboxConversationEventEntity)
    private readonly eventsRepository: Repository<InboxConversationEventEntity>,
  ) {}

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

  async listChannels(ctx: RequestContext) {
    return this.channelsRepository.find({
      where: {
        ...this.scope(ctx),
        deletedAt: IsNull(),
      },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  async createChannel(ctx: RequestContext, dto: CreateInboxChannelDto) {
    const channel = this.channelsRepository.create({
      ...this.scope(ctx),
      name: dto.name.trim(),
      type: dto.type ?? 'manual',
      status: dto.status ?? 'active',
      provider: dto.provider?.trim() || null,
      externalId: dto.externalId?.trim() || null,
      defaultAssignedUserId: dto.defaultAssignedUserId ?? null,
      defaultAgentId: dto.defaultAgentId ?? null,
      aiEnabled: dto.aiEnabled ?? false,
      settings: dto.settings ?? {},
      metadata: dto.metadata ?? {},
    });

    return this.channelsRepository.save(channel);
  }

  async patchChannel(ctx: RequestContext, id: string, dto: PatchInboxChannelDto) {
    const channel = await this.channelsRepository.findOne({
      where: {
        ...this.scope(ctx),
        id,
        deletedAt: IsNull(),
      },
    });

    if (!channel) {
      throw new NotFoundException('Inbox channel not found.');
    }

    Object.assign(channel, {
      name: dto.name?.trim() ?? channel.name,
      type: dto.type ?? channel.type,
      status: dto.status ?? channel.status,
      provider: dto.provider !== undefined ? dto.provider?.trim() || null : channel.provider,
      externalId: dto.externalId !== undefined ? dto.externalId?.trim() || null : channel.externalId,
      defaultAssignedUserId: dto.defaultAssignedUserId !== undefined ? dto.defaultAssignedUserId : channel.defaultAssignedUserId,
      defaultAgentId: dto.defaultAgentId !== undefined ? dto.defaultAgentId : channel.defaultAgentId,
      aiEnabled: dto.aiEnabled ?? channel.aiEnabled,
      settings: dto.settings ?? channel.settings,
      metadata: dto.metadata ?? channel.metadata,
    });

    return this.channelsRepository.save(channel);
  }

  async listConversations(ctx: RequestContext, filters: InboxConversationFilters) {
    const where: FindOptionsWhere<InboxConversationEntity> = {
      ...this.scope(ctx),
    };

    if (filters.status) where.status = filters.status as InboxConversationEntity['status'];
    if (filters.priority) where.priority = filters.priority as InboxConversationEntity['priority'];
    if (filters.channelId) where.channelId = filters.channelId;
    if (filters.contactId) where.contactId = filters.contactId;
    if (filters.assignedUserId) where.assignedUserId = filters.assignedUserId;
    if (filters.q) where.title = ILike(`%${filters.q}%`);

    const [items, total] = await this.conversationsRepository.findAndCount({
      where,
      order: {
        lastMessageAt: 'DESC',
        updatedAt: 'DESC',
      },
      take: 100,
    });

    return { items, total };
  }

  async createConversation(ctx: RequestContext, dto: CreateInboxConversationDto) {
    const now = new Date();

    const conversation = await this.conversationsRepository.save(
      this.conversationsRepository.create({
        ...this.scope(ctx),
        channelId: dto.channelId ?? null,
        contactId: dto.contactId ?? null,
        externalThreadId: dto.externalThreadId?.trim() || null,
        title: dto.title?.trim() || null,
        status: dto.status ?? 'new',
        priority: dto.priority ?? 'normal',
        assignedUserId: dto.assignedUserId ?? null,
        assignedAgentId: dto.assignedAgentId ?? null,
        source: dto.source?.trim() || 'manual',
        businessMode: dto.businessMode?.trim() || 'general',
        aiEnabled: dto.aiEnabled ?? false,
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
    const conversation = await this.conversationsRepository.findOne({
      where: {
        ...this.scope(ctx),
        id,
      },
    });

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
    const before = {
      status: conversation.status,
      priority: conversation.priority,
      assignedUserId: conversation.assignedUserId,
    };

    Object.assign(conversation, {
      channelId: dto.channelId !== undefined ? dto.channelId : conversation.channelId,
      contactId: dto.contactId !== undefined ? dto.contactId : conversation.contactId,
      externalThreadId: dto.externalThreadId !== undefined ? dto.externalThreadId?.trim() || null : conversation.externalThreadId,
      title: dto.title !== undefined ? dto.title?.trim() || null : conversation.title,
      status: dto.status ?? conversation.status,
      priority: dto.priority ?? conversation.priority,
      assignedUserId: dto.assignedUserId !== undefined ? dto.assignedUserId : conversation.assignedUserId,
      assignedAgentId: dto.assignedAgentId !== undefined ? dto.assignedAgentId : conversation.assignedAgentId,
      source: dto.source?.trim() || conversation.source,
      businessMode: dto.businessMode?.trim() || conversation.businessMode,
      aiEnabled: dto.aiEnabled ?? conversation.aiEnabled,
      metadata: dto.metadata ?? conversation.metadata,
      closedAt: dto.status === 'closed' || dto.status === 'resolved' ? new Date() : conversation.closedAt,
      archivedAt: dto.status === 'archived' ? new Date() : conversation.archivedAt,
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

  async listMessages(ctx: RequestContext, conversationId: string) {
    await this.getConversation(ctx, conversationId);

    return this.messagesRepository.find({
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

  async createMessage(
    ctx: RequestContext,
    conversationId: string,
    dto: CreateInboxMessageDto,
  ) {
    const conversation = await this.getConversation(ctx, conversationId);
    const now = new Date();

    const direction = dto.direction ?? 'outbound';
    const senderType = dto.senderType ?? (direction === 'internal' ? 'user' : 'user');

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
        messageType: dto.messageType ?? 'text',
        content: dto.content.trim(),
        status: dto.status ?? 'sent',
        attachments: dto.attachments ?? [],
        metadata: dto.metadata ?? {},
        sentAt: direction === 'outbound' ? now : null,
      }),
    );

    conversation.lastMessagePreview = message.content.slice(0, 260);
    conversation.lastMessageAt = message.createdAt ?? now;
    conversation.status = conversation.status === 'new' ? 'open' : conversation.status;

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
    const title =
      input.pageTitle?.trim() ||
      input.metadata?.visitorName?.toString() ||
      input.metadata?.visitorEmail?.toString() ||
      'Conversa do Webchat';

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
      existing.title = existing.title || title;
      existing.status = mappedStatus;
      existing.assignedUserId = input.assignedUserId ?? existing.assignedUserId;
      existing.assignedAgentId = input.assignedAgentId ?? existing.assignedAgentId;
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
        externalThreadId: input.conversationId,
        title,
        status: mappedStatus,
        priority: 'normal',
        assignedUserId: input.assignedUserId ?? null,
        assignedAgentId: input.assignedAgentId ?? null,
        source: 'webchat',
        businessMode: 'general',
        aiEnabled: input.aiEnabled ?? false,
        lastMessageAt: input.lastMessageAt ? new Date(input.lastMessageAt) : null,
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
      }),
    );

    conversation.lastMessagePreview = message.content.slice(0, 260);
    conversation.lastMessageAt = message.createdAt ?? new Date();

    if (input.direction === 'inbound') {
      conversation.unreadCount = (conversation.unreadCount ?? 0) + 1;
      conversation.status = conversation.status === 'new' ? 'open' : conversation.status;
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

}
