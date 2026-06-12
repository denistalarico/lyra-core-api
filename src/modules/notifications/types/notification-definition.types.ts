import {
  NotificationActionType,
  NotificationCatalogStatus,
  NotificationCategory,
  NotificationDefaultDelivery,
  NotificationPreferencePolicy,
  NotificationPriority,
  NotificationProductKey,
  NotificationRecipientStrategy,
  NotificationSelfPolicy,
} from '../enums';

export type NotificationDefinition = {
  eventType: string;
  productKey: NotificationProductKey;
  moduleKey: string;

  category: NotificationCategory;
  defaultPriority: NotificationPriority;
  defaultActionType: NotificationActionType;

  recipientStrategy: NotificationRecipientStrategy;
  selfNotificationPolicy: NotificationSelfPolicy;
  preferencePolicy: NotificationPreferencePolicy;

  preferenceKey: string;

  defaultDelivery: NotificationDefaultDelivery;
  required: boolean;
  groupable: boolean;

  catalogStatus: NotificationCatalogStatus;

  expiresAfterSeconds?: number;
};

export type NotificationDefinitionInput = Omit<
  NotificationDefinition,
  | 'productKey'
  | 'preferenceKey'
  | 'required'
  | 'groupable'
  | 'catalogStatus'
> &
  Partial<
    Pick<
      NotificationDefinition,
      | 'productKey'
      | 'preferenceKey'
      | 'required'
      | 'groupable'
      | 'catalogStatus'
      | 'expiresAfterSeconds'
    >
  >;
