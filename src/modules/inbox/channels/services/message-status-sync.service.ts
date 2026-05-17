import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InboxConversationEventEntity } from '../../entities/inbox-conversation-event.entity';
import { InboxMessageEntity } from '../../entities/inbox-message.entity';
import type {
  NormalizedMessageDeliveryStatus,
  NormalizedMessageStatusUpdate,
} from '../types/normalized-message-status-update';

@Injectable()
export class MessageStatusSyncService {
  constructor(
    @InjectRepository(InboxMessageEntity)
    private readonly messagesRepository: Repository<InboxMessageEntity>,
    @InjectRepository(InboxConversationEventEntity)
    private readonly eventsRepository: Repository<InboxConversationEventEntity>,
  ) {}

  async applyStatusUpdate(input: NormalizedMessageStatusUpdate) {
    const message = await this.messagesRepository.findOne({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        externalMessageId: input.externalMessageId,
      },
    });

    if (!message) {
      throw new NotFoundException(
        `Inbox message not found for external_message_id ${input.externalMessageId}.`,
      );
    }

    const occurredAt = input.occurredAt ?? new Date();
    const previousStatus = message.status;

    message.status = this.mapInboxMessageStatus(input.status);

    if (input.status === 'delivered') {
      message.deliveredAt = occurredAt;
    }

    if (input.status === 'read') {
      message.readAt = occurredAt;
      message.deliveredAt = message.deliveredAt ?? occurredAt;
    }

    message.metadata = {
      ...(message.metadata ?? {}),
      lastDeliveryStatus: input.status,
      lastDeliveryStatusAt: occurredAt.toISOString(),
      deliveryStatusMetadata: input.metadata ?? {},
    };

    await this.messagesRepository.save(message);

    await this.eventsRepository.save(
      this.eventsRepository.create({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        conversationId: message.conversationId,
        eventType: 'message_status_updated',
        actorType: 'system',
        actorUserId: null,
        payload: {
          messageId: message.id,
          externalMessageId: input.externalMessageId,
          provider: input.provider,
          channelId: input.channelId,
          channelType: input.channelType,
          previousStatus,
          status: input.status,
          recipientId: input.recipientId ?? null,
          occurredAt: occurredAt.toISOString(),
          metadata: input.metadata ?? {},
        },
      }),
    );

    return message;
  }

  private mapInboxMessageStatus(status: NormalizedMessageDeliveryStatus) {
    switch (status) {
      case 'sent':
        return 'sent' as InboxMessageEntity['status'];
      case 'delivered':
        return 'delivered' as InboxMessageEntity['status'];
      case 'read':
        return 'read' as InboxMessageEntity['status'];
      case 'failed':
        return 'failed' as InboxMessageEntity['status'];
      default:
        return 'sent' as InboxMessageEntity['status'];
    }
  }
}
