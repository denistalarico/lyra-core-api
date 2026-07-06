import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { InboxConversationEntity } from '../../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../../entities/inbox-conversation-event.entity';
import { InboxMessageEntity } from '../../entities/inbox-message.entity';
import { InboxNotificationPublisher } from '../../services/inbox-notification.publisher';
import type { NormalizedInboundMessage } from '../types/normalized-inbound-message';

@Injectable()
export class InboundMessageIngestionService {
  constructor(
    @InjectRepository(InboxConversationEntity)
    private readonly conversationsRepository: Repository<InboxConversationEntity>,
    @InjectRepository(InboxMessageEntity)
    private readonly messagesRepository: Repository<InboxMessageEntity>,
    @InjectRepository(InboxConversationEventEntity)
    private readonly eventsRepository: Repository<InboxConversationEventEntity>,
    private readonly notificationPublisher: InboxNotificationPublisher,
  ) {}

  async ingest(input: NormalizedInboundMessage) {
    const occurredAt = input.occurredAt ?? new Date();

    const conversation = await this.findOrCreateConversation(input, occurredAt);

    const messagePayload: DeepPartial<InboxMessageEntity> = {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      conversationId: conversation.id,
      channelId: input.channelId,
      contactId: conversation.contactId ?? null,
      direction: 'inbound' as InboxMessageEntity['direction'],
      senderType: 'contact' as InboxMessageEntity['senderType'],
      senderUserId: null,
      senderAgentId: null,
      externalMessageId: input.externalMessageId ?? null,
      messageType: input.messageType as InboxMessageEntity['messageType'],
      content: input.content,
      status: 'received' as InboxMessageEntity['status'],
      attachments: (input.attachments ?? []) as unknown as Record<
        string,
        unknown
      >[],
      metadata: {
        ...(input.metadata ?? {}),
        provider: input.provider ?? null,
        channelType: input.channelType,
        sender: input.sender,
        rawPayload: input.rawPayload ?? null,
      },
      sentAt: occurredAt,
      deliveredAt: null,
      readAt: null,
    };

    const message = await this.messagesRepository.save(
      this.messagesRepository.create(messagePayload),
    );

    conversation.lastMessagePreview = this.createPreview(input.content);
    conversation.lastMessageAt = occurredAt;
    conversation.unreadCount = (conversation.unreadCount ?? 0) + 1;

    if (
      conversation.status === 'closed' ||
      conversation.status === 'archived'
    ) {
      conversation.status = 'new';
      conversation.closedAt = null;
      conversation.archivedAt = null;
    }

    await this.conversationsRepository.save(conversation);

    await this.eventsRepository.save(
      this.eventsRepository.create({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
        eventType: 'message_received',
        actorType: 'system',
        actorUserId: null,
        payload: {
          messageId: message.id,
          channelId: input.channelId,
          channelType: input.channelType,
          provider: input.provider ?? null,
          externalThreadId: input.externalThreadId,
          externalMessageId: input.externalMessageId ?? null,
          sender: input.sender,
        },
      }),
    );

    await this.notificationPublisher.publishInboundMessage({
      conversation,
      message,
    });

    return {
      conversation,
      message,
    };
  }

  private async findOrCreateConversation(
    input: NormalizedInboundMessage,
    occurredAt: Date,
  ) {
    const existing = await this.conversationsRepository.findOne({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        externalThreadId: input.externalThreadId,
      },
    });

    if (existing) {
      return existing;
    }

    return this.conversationsRepository.save(
      this.conversationsRepository.create({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        contactId: null,
        externalThreadId: input.externalThreadId,
        title: this.createConversationTitle(input),
        status: 'new',
        priority: 'normal',
        assignedUserId: null,
        assignedAgentId: null,
        source: input.channelType,
        businessMode: 'general',
        lastMessagePreview: this.createPreview(input.content),
        lastMessageAt: occurredAt,
        unreadCount: 0,
        aiEnabled: false,
        closedAt: null,
        archivedAt: null,
        metadata: {
          provider: input.provider ?? null,
          channelType: input.channelType,
          sender: input.sender,
        },
      }),
    );
  }

  private createPreview(content: string) {
    return content.trim().slice(0, 260);
  }

  private createConversationTitle(input: NormalizedInboundMessage) {
    return (
      input.sender.name ||
      input.sender.phone ||
      input.sender.email ||
      input.sender.username ||
      input.sender.externalId ||
      'Nova conversa'
    ).slice(0, 180);
  }
}
