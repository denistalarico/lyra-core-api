import {
  NotificationActionType,
  NotificationActorType,
  NotificationCategory,
  NotificationInterestReason,
  NotificationPriority,
  NotificationProductKey,
} from '../enums';

export type NotificationListItem = {
  id: string;
  recipientId: string;

  productKey: NotificationProductKey;
  moduleKey: string;
  eventType: string;
  category: NotificationCategory;
  priority: NotificationPriority;

  title: string;
  body: string;

  actionType: NotificationActionType;
  actionUrl: string | null;

  resourceType: string | null;
  resourceId: string | null;

  actorType: NotificationActorType;
  actorUserId: string | null;

  interestReason: NotificationInterestReason;

  occurredAt: string;
  expiresAt: string | null;
  createdAt: string;

  seenAt: string | null;
  readAt: string | null;
  archivedAt: string | null;

  isSeen: boolean;
  isRead: boolean;
  isArchived: boolean;
  isExpired: boolean;
};

export type NotificationListResponse = {
  items: NotificationListItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type NotificationUnreadCountResponse = {
  count: number;
  byProduct: Partial<Record<NotificationProductKey, number>>;
};
