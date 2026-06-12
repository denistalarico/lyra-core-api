import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../enums';

export type NotificationExplicitRecipient = {
  userId: string;
  interestReason: NotificationInterestReason;
};

export type NotificationSourceEvent = {
  eventId: string;
  eventType: string;

  tenantId: string;
  workspaceId?: string | null;
  managedTenantId?: string | null;

  productKey: NotificationProductKey;
  moduleKey: string;

  actorType: NotificationActorType;
  actorUserId?: string | null;
  initiatedByUserId?: string | null;

  resourceType?: string | null;
  resourceId?: string | null;

  occurredAt: string;

  recipients?: NotificationExplicitRecipient[];

  payload: Record<string, unknown>;
};
