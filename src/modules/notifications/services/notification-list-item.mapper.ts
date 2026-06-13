import { NotificationRecipientEntity } from '../entities';
import { NotificationListItem } from '../types';

export function mapNotificationRecipientToListItem(
  recipient: NotificationRecipientEntity,
): NotificationListItem {
  const notification = recipient.notification;
  const now = Date.now();

  return {
    id: notification.id,
    recipientId: recipient.id,

    productKey: notification.productKey,
    moduleKey: notification.moduleKey,
    eventType: notification.eventType,
    category: notification.category,
    priority: notification.priority,

    title: notification.title,
    body: notification.body,

    actionType: notification.actionType,
    actionUrl: notification.actionUrl,

    resourceType: notification.resourceType,
    resourceId: notification.resourceId,

    actorType: notification.actorType,
    actorUserId: notification.actorUserId,

    interestReason: recipient.interestReason,

    occurredAt: notification.occurredAt.toISOString(),
    expiresAt: notification.expiresAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),

    seenAt: recipient.seenAt?.toISOString() ?? null,
    readAt: recipient.readAt?.toISOString() ?? null,
    archivedAt: recipient.archivedAt?.toISOString() ?? null,

    isSeen: Boolean(recipient.seenAt),
    isRead: Boolean(recipient.readAt),
    isArchived: Boolean(recipient.archivedAt),
    isExpired: Boolean(
      notification.expiresAt &&
        notification.expiresAt.getTime() <= now,
    ),
  };
}
