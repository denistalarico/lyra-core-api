import {
  NotificationActionType,
  NotificationAudience,
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

  /**
   * NTF-C1 §6 — which surfaces this event may address. Defaults to `AGENCY`,
   * so every definition written before NTF-C1 keeps its exact behaviour
   * without being touched; an event reaches the Client Area only by saying so.
   *
   * This is a *permission*, not an instruction: it bounds which recipient
   * surfaces the processor will accept for the event. The publisher still
   * decides who is actually addressed.
   */
  audience: NotificationAudience;

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
  | 'audience'
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
      | 'audience'
    >
  >;
