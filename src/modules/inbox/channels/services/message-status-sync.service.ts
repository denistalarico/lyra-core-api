import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, QueryFailedError, Repository } from 'typeorm';
import { InboxConversationEventEntity } from '../../entities/inbox-conversation-event.entity';
import { InboxConversationEntity } from '../../entities/inbox-conversation.entity';
import { InboxDomainOutboxEntity } from '../../entities/inbox-domain-outbox.entity';
import { InboxMessageEntity } from '../../entities/inbox-message.entity';
import type { NormalizedMessageReactionUpdate } from '../types/normalized-message-reaction-update';
import type {
  NormalizedMessageDeliveryStatus,
  NormalizedMessageStatusUpdate,
  NormalizedMessageStatusWatermarkUpdate,
} from '../types/normalized-message-status-update';
import { InboxMetaOperationLedgerService } from '../whatsapp/services/inbox-meta-operation-ledger.service';

/**
 * Providers redeliver and reorder webhooks, so a later event can carry an
 * earlier status (e.g. a retried `failed` after the message was already
 * `read`). Ranks make status application monotonic: an update only takes
 * effect when it does not regress the message below its current rank.
 */
const MESSAGE_STATUS_RANK: Record<InboxMessageEntity['status'], number> = {
  draft: 0,
  received: 0,
  pending: 0,
  sent: 1,
  failed: 1,
  delivered: 2,
  read: 3,
};

@Injectable()
export class MessageStatusSyncService {
  constructor(
    @InjectRepository(InboxMessageEntity, 'agency')
    private readonly messagesRepository: Repository<InboxMessageEntity>,
    @InjectRepository(InboxConversationEntity, 'agency')
    private readonly conversationsRepository: Repository<InboxConversationEntity>,
    @InjectRepository(InboxConversationEventEntity, 'agency')
    private readonly eventsRepository: Repository<InboxConversationEventEntity>,
    @InjectRepository(InboxDomainOutboxEntity, 'agency')
    private readonly outboxRepository: Repository<InboxDomainOutboxEntity>,
    private readonly metaLedger: InboxMetaOperationLedgerService,
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
        'Inbox message not found for the provider status update.',
      );
    }

    const occurredAt = input.occurredAt ?? new Date();
    const previousStatus = message.status;
    const nextStatus = this.mapInboxMessageStatus(input.status);
    const isRegression =
      MESSAGE_STATUS_RANK[nextStatus] < MESSAGE_STATUS_RANK[previousStatus];

    if (!isRegression) {
      message.status = nextStatus;

      if (input.status === 'delivered' && !message.deliveredAt) {
        message.deliveredAt = occurredAt;
      }

      if (input.status === 'read') {
        if (!message.readAt || message.readAt < occurredAt) {
          message.readAt = occurredAt;
        }
        message.deliveredAt = message.deliveredAt ?? occurredAt;
      }

      message.metadata = {
        ...(message.metadata ?? {}),
        lastDeliveryStatus: input.status,
        lastDeliveryStatusAt: occurredAt.toISOString(),
        deliveryStatusMetadata: input.metadata ?? {},
      };

      await this.messagesRepository.save(message);

      await this.metaLedger.reconcileDelivery({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        messageId: message.id,
        status: input.status,
        occurredAt,
      });
    }

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
          ignoredAsRegression: isRegression,
          recipientId: input.recipientId ?? null,
          occurredAt: occurredAt.toISOString(),
          metadata: input.metadata ?? {},
        },
      }),
    );

    if (!isRegression) {
      await this.recordRealtimeEvent({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        conversationId: message.conversationId,
        eventName: 'leadflow.inbox.conversation.message.status_updated',
        idempotencyKey: `message.status_updated:${message.id}:${input.status}:${occurredAt.getTime()}`,
        payload: {
          conversationId: message.conversationId,
          messageId: message.id,
          status: input.status,
          occurredAt: occurredAt.toISOString(),
        },
      });
    }

    return message;
  }

  /**
   * Messenger reports delivery/read as a watermark on the thread instead of
   * per message id. The last watermark applied is kept on the conversation
   * so a repeated or stale webhook (same or earlier watermark) is a no-op
   * instead of rescanning every outbound message in the thread.
   */
  async applyStatusWatermark(input: NormalizedMessageStatusWatermarkUpdate) {
    const conversation = await this.conversationsRepository.findOne({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        channelId: input.channelId,
        externalThreadId: input.externalThreadId,
      },
    });

    if (!conversation) {
      throw new NotFoundException(
        'Inbox conversation not found for the provider watermark update.',
      );
    }

    const watermarkKey =
      input.status === 'read' ? 'lastReadWatermark' : 'lastDeliveredWatermark';
    const previousWatermarkRaw = conversation.metadata?.[watermarkKey];
    const previousWatermarkAt =
      typeof previousWatermarkRaw === 'string'
        ? new Date(previousWatermarkRaw)
        : null;

    if (
      previousWatermarkAt &&
      previousWatermarkAt.getTime() >= input.watermark.getTime()
    ) {
      return { conversationId: conversation.id, updatedMessageIds: [] };
    }

    const targetStatus: InboxMessageEntity['status'] = input.status;
    const targetRank = MESSAGE_STATUS_RANK[targetStatus];

    const candidates = await this.messagesRepository.find({
      where: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
        direction: 'outbound',
        occurredAt: previousWatermarkAt
          ? Between(previousWatermarkAt, input.watermark)
          : LessThanOrEqual(input.watermark),
      },
    });

    const updated = candidates.filter(
      (message) => MESSAGE_STATUS_RANK[message.status] < targetRank,
    );

    for (const message of updated) {
      message.status = targetStatus;

      if (input.status === 'delivered' && !message.deliveredAt) {
        message.deliveredAt = input.watermark;
      }

      if (input.status === 'read') {
        if (!message.readAt || message.readAt < input.watermark) {
          message.readAt = input.watermark;
        }
        message.deliveredAt = message.deliveredAt ?? input.watermark;
      }
    }

    if (updated.length > 0) {
      await this.messagesRepository.save(updated);
    }

    conversation.metadata = {
      ...(conversation.metadata ?? {}),
      [watermarkKey]: input.watermark.toISOString(),
    };
    await this.conversationsRepository.save(conversation);

    const updatedMessageIds = updated.map((message) => message.id);

    await this.eventsRepository.save(
      this.eventsRepository.create({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
        eventType: 'message_status_watermark_applied',
        actorType: 'system',
        actorUserId: null,
        payload: {
          provider: input.provider,
          channelId: input.channelId,
          channelType: input.channelType,
          status: input.status,
          watermark: input.watermark.toISOString(),
          updatedMessageIds,
          recipientId: input.recipientId ?? null,
          metadata: input.metadata ?? {},
        },
      }),
    );

    if (updatedMessageIds.length > 0) {
      await this.recordRealtimeEvent({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        conversationId: conversation.id,
        eventName: 'leadflow.inbox.conversation.message.status_updated',
        idempotencyKey: `message.status_watermark:${conversation.id}:${input.status}:${input.watermark.getTime()}`,
        payload: {
          conversationId: conversation.id,
          status: input.status,
          occurredAt: input.watermark.toISOString(),
          updatedMessageIds,
        },
      });
    }

    return { conversationId: conversation.id, updatedMessageIds };
  }

  async applyReaction(input: NormalizedMessageReactionUpdate) {
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
        'Inbox message not found for the provider reaction update.',
      );
    }
    const metadata = message.metadata ?? {};
    const reactions = Array.isArray(metadata.reactions)
      ? metadata.reactions.filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === 'object'),
        )
      : [];
    const actorKey = `${input.channelType}:${input.senderId ?? 'contact'}`;
    const next = reactions.filter((item) => item.actorKey !== actorKey);
    if (input.action === 'react' && input.emoji) {
      next.push({
        actorKey,
        actorType: 'contact',
        emoji: input.emoji,
        reactedAt: input.occurredAt.toISOString(),
      });
    }
    message.metadata = {
      ...metadata,
      reaction: next.at(-1) ?? null,
      reactions: next,
      reactionDelivery: 'received',
    };
    await this.messagesRepository.save(message);
    await this.eventsRepository.save(
      this.eventsRepository.create({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        conversationId: message.conversationId,
        eventType:
          input.action === 'unreact'
            ? 'message_reaction_removed'
            : 'message_reacted',
        actorType: 'contact',
        actorUserId: null,
        payload: {
          messageId: message.id,
          externalMessageId: input.externalMessageId,
          emoji: input.emoji,
          provider: input.provider,
          channelType: input.channelType,
        },
      }),
    );

    await this.recordRealtimeEvent({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      conversationId: message.conversationId,
      eventName: 'leadflow.inbox.conversation.message.reaction_updated',
      idempotencyKey: `message.reaction_updated:${message.id}:${input.action}:${input.occurredAt.getTime()}`,
      payload: {
        conversationId: message.conversationId,
        messageId: message.id,
        occurredAt: input.occurredAt.toISOString(),
      },
    });

    return message;
  }

  /**
   * Providers redeliver webhooks, and this service is not wrapped in a
   * transaction, so a repeated event can race here. The idempotency key
   * carries the dedupe: a unique-constraint hit means the event was already
   * recorded, so it is swallowed rather than surfaced as a webhook failure.
   */
  private async recordRealtimeEvent(input: {
    tenantId: string;
    workspaceId: string;
    conversationId: string;
    eventName: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }) {
    try {
      await this.outboxRepository.save(
        this.outboxRepository.create({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          aggregateType: 'inbox_conversation',
          aggregateId: input.conversationId,
          eventName: input.eventName,
          eventVersion: 1,
          idempotencyKey: input.idempotencyKey,
          payload: input.payload,
          publishedAt: null,
        }),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
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

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error as QueryFailedError & { code?: string }).code === '23505'
  );
}
