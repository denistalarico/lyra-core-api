import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotificationCatalogService } from '../catalog';
import {
  NotificationDeliveryEntity,
  NotificationEntity,
  NotificationRecipientEntity,
} from '../entities';
import {
  NotificationDeliveryChannel,
  NotificationDeliveryStatus,
} from '../enums';
import { SelfNotificationPolicy } from '../policies/self-notification.policy';
import {
  NotificationProcessingResult,
  NotificationSourceEvent,
} from '../types';
import { NotificationRecipientResolverService } from './notification-recipient-resolver.service';

@Injectable()
export class NotificationEventProcessorService {
  constructor(
    @InjectDataSource('agency')
    private readonly dataSource: DataSource,
    private readonly catalog: NotificationCatalogService,
    private readonly recipientResolver: NotificationRecipientResolverService,
    private readonly selfNotificationPolicy: SelfNotificationPolicy,
  ) {}

  async process(
    event: NotificationSourceEvent,
  ): Promise<NotificationProcessingResult> {
    const definition = this.catalog.requireDefinition(
      event.productKey,
      event.eventType,
    );

    if (definition.moduleKey !== event.moduleKey) {
      throw new Error(
        `Notification module mismatch for ${event.eventType}: ` +
          `expected ${definition.moduleKey}, received ${event.moduleKey}`,
      );
    }

    const resolvedRecipients = this.recipientResolver.resolve(
      event,
      definition,
    );

    const recipients = this.selfNotificationPolicy.apply(
      event,
      resolvedRecipients,
      definition.selfNotificationPolicy,
    );

    if (recipients.length === 0) {
      return {
        status: 'skipped',
        reason: 'no_recipients',
        recipientCount: 0,
      };
    }

    return this.dataSource.transaction(async (manager) => {
      const notificationRepo =
        manager.getRepository(NotificationEntity);

      const existing = await notificationRepo.findOne({
        where: {
          tenantId: event.tenantId,
          sourceEventId: event.eventId,
        },
        relations: {
          recipients: true,
        },
      });

      if (existing) {
        return {
          status: 'duplicate',
          notificationId: existing.id,
          recipientCount: existing.recipients?.length ?? 0,
        };
      }

      const occurredAt = new Date(event.occurredAt);

      if (Number.isNaN(occurredAt.getTime())) {
        throw new Error(
          `Invalid notification occurredAt: ${event.occurredAt}`,
        );
      }

      const expiresAt = definition.expiresAfterSeconds
        ? new Date(
            occurredAt.getTime() +
              definition.expiresAfterSeconds * 1000,
          )
        : null;

      const notification = notificationRepo.create({
        tenantId: event.tenantId,
        workspaceId: event.workspaceId ?? null,
        managedTenantId: event.managedTenantId ?? null,

        productKey: definition.productKey,
        moduleKey: definition.moduleKey,
        eventType: definition.eventType,
        category: definition.category,
        priority: definition.defaultPriority,

        title: this.resolveTitle(event),
        body: this.resolveBody(event),

        actionType: definition.defaultActionType,
        actionUrl: this.optionalString(
          event.payload.actionUrl,
        ),

        resourceType: event.resourceType ?? null,
        resourceId: event.resourceId ?? null,

        actorType: event.actorType,
        actorUserId: event.actorUserId ?? null,
        initiatedByUserId: event.initiatedByUserId ?? null,

        sourceEventId: event.eventId,
        deduplicationKey: this.optionalString(
          event.payload.deduplicationKey,
        ),

        templateKey: `notifications.${event.eventType}`,
        templateVariables: event.payload,
        metadata: this.resolveMetadata(event),

        occurredAt,
        expiresAt,
      });

      const savedNotification =
        await notificationRepo.save(notification);

      const recipientRepo =
        manager.getRepository(NotificationRecipientEntity);

      const recipientEntities = recipients.map((recipient) =>
        recipientRepo.create({
          notificationId: savedNotification.id,
          userId: recipient.userId,
          interestReason: recipient.interestReason,
          seenAt: null,
          readAt: null,
          archivedAt: null,
          dismissedAt: null,
        }),
      );

      const savedRecipients =
        await recipientRepo.save(recipientEntities);

      const deliveryRepo =
        manager.getRepository(NotificationDeliveryEntity);

      const deliveries = savedRecipients.map((recipient) =>
        deliveryRepo.create({
          notificationRecipientId: recipient.id,
          channel: NotificationDeliveryChannel.IN_APP,
          status: NotificationDeliveryStatus.SENT,
          scheduledAt: null,
          sentAt: new Date(),
          failedAt: null,
          failureReason: null,
          attempts: 1,
          providerMessageId: null,
        }),
      );

      await deliveryRepo.save(deliveries);

      return {
        status: 'created',
        notificationId: savedNotification.id,
        recipientCount: savedRecipients.length,
      };
    });
  }

  private resolveTitle(
    event: NotificationSourceEvent,
  ): string {
    const title = event.payload.title;

    if (typeof title === 'string' && title.trim()) {
      return title.trim().slice(0, 180);
    }

    return event.eventType;
  }

  private resolveBody(
    event: NotificationSourceEvent,
  ): string {
    const body =
      event.payload.body ?? event.payload.message;

    if (typeof body === 'string' && body.trim()) {
      return body.trim();
    }

    return event.eventType;
  }

  private resolveMetadata(
    event: NotificationSourceEvent,
  ): Record<string, unknown> {
    const metadata = event.payload.metadata;

    if (
      metadata &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata)
    ) {
      return metadata as Record<string, unknown>;
    }

    return {};
  }

  private optionalString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();

    return normalized || null;
  }
}
