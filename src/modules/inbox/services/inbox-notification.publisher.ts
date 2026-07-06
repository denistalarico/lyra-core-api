import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxMessageEntity } from '../entities/inbox-message.entity';

type InboundMessageNotificationInput = {
  conversation: InboxConversationEntity;
  message: InboxMessageEntity;
};

@Injectable()
export class InboxNotificationPublisher {
  private readonly logger = new Logger(InboxNotificationPublisher.name);

  constructor(
    private readonly notificationEventProcessor: NotificationEventProcessorService,
  ) {}

  /**
   * Notifies the operator handling a conversation about an inbound message.
   * Honors the per-conversation `muted` flag toggled from the Inbox UI. v1
   * targets the assigned user only — unassigned conversations have no specific
   * operator to notify yet.
   */
  async publishInboundMessage(input: InboundMessageNotificationInput) {
    const { conversation, message } = input;
    const metadata = conversation.metadata ?? {};

    if (metadata.muted === true) {
      return;
    }

    const assignedUserId = conversation.assignedUserId?.trim();
    if (!assignedUserId) {
      return;
    }

    const preview = (message.content ?? '').trim().slice(0, 160);
    const channelType =
      typeof metadata.channelType === 'string'
        ? metadata.channelType
        : conversation.source;

    try {
      await this.notificationEventProcessor.process({
        eventId: `inbox.message_received:${message.id}`,
        eventType: 'inbox.message_received',
        tenantId: conversation.tenantId,
        workspaceId: conversation.workspaceId,
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'inbox',
        actorType: NotificationActorType.SYSTEM,
        actorUserId: null,
        resourceType: 'inbox_conversation',
        resourceId: conversation.id,
        occurredAt: (message.createdAt ?? new Date()).toISOString(),
        recipients: [
          {
            userId: assignedUserId,
            interestReason: NotificationInterestReason.ASSIGNED,
          },
        ],
        payload: {
          title: conversation.title
            ? `Nova mensagem de ${conversation.title}`
            : 'Nova mensagem no Inbox',
          body: preview || 'Você recebeu uma nova mensagem.',
          actionUrl: '/leadflow/inbox',
          conversationId: conversation.id,
          messageId: message.id,
          channelType,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish inbox.message_received for conversation ${conversation.id} tenant ${conversation.tenantId} workspace ${conversation.workspaceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
