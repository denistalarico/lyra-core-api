export enum NotificationProductKey {
  AGENCY = 'agency',
  LEADFLOW = 'leadflow',
  SOCIAL = 'social',
  ADMIN = 'admin',
  PLATFORM = 'platform',
}

export enum NotificationPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum NotificationActionType {
  NONE = 'none',
  INTERNAL_ROUTE = 'internal_route',
}

export enum NotificationActorType {
  USER = 'user',
  SYSTEM = 'system',
  AGENT = 'agent',
  INTEGRATION = 'integration',
}

export enum NotificationCategory {
  ASSIGNMENT = 'assignment',
  MENTION = 'mention',
  COMMENT = 'comment',
  APPROVAL = 'approval',
  DEADLINE = 'deadline',
  OVERDUE = 'overdue',
  STATUS = 'status',
  FINANCIAL = 'financial',
  CONTRACT = 'contract',
  SECURITY = 'security',
  SYSTEM = 'system',
  INTEGRATION = 'integration',
  MESSAGE = 'message',
  CALENDAR = 'calendar',
  ONBOARDING = 'onboarding',
  OFFBOARDING = 'offboarding',
  DOCUMENT = 'document',
  PROCESSING = 'processing',
  RISK = 'risk',
}

export enum NotificationInterestReason {
  ASSIGNED = 'assigned',
  MENTIONED = 'mentioned',
  OWNER = 'owner',
  PARTICIPANT = 'participant',
  WATCHING = 'watching',
  APPROVER = 'approver',
  MANAGER = 'manager',
  REQUESTER = 'requester',
  RESPONSIBLE_ROLE = 'responsible_role',
  SECURITY_SUBJECT = 'security_subject',
  SYSTEM_TARGET = 'system_target',
}

export enum NotificationDeliveryChannel {
  IN_APP = 'in_app',
  EMAIL = 'email',
  PUSH = 'push',
}

export enum NotificationDeliveryStatus {
  PENDING = 'pending',
  SCHEDULED = 'scheduled',
  SENT = 'sent',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

export enum NotificationSelfPolicy {
  SUPPRESS_ACTOR = 'suppress_actor',
  ALLOW_ACTOR = 'allow_actor',
  ACTOR_ONLY = 'actor_only',
}

export enum NotificationPreferencePolicy {
  CONFIGURABLE = 'configurable',
  REQUIRED = 'required',
}

export enum NotificationDefaultDelivery {
  ENABLED = 'enabled',
  DISABLED = 'disabled',
}

export enum NotificationRecipientStrategy {
  EXPLICIT_USERS = 'explicit_users',
  ASSIGNED_USER = 'assigned_user',
  MENTIONED_USERS = 'mentioned_users',
  RESOURCE_OWNER = 'resource_owner',
  PARTICIPANTS = 'participants',
  WATCHING = 'watching',
  APPROVERS = 'approvers',
  MANAGERS = 'managers',
  REQUESTER = 'requester',
  RESPONSIBLE_ROLE = 'responsible_role',
  SECURITY_SUBJECT = 'security_subject',
  SYSTEM_TARGET = 'system_target',
}

export enum NotificationCatalogStatus {
  CATALOGED = 'cataloged',
  EMITTED = 'emitted',
  DELIVERED = 'delivered',
}

/**
 * NTF-C1 — which product surface a recipient was addressed *as*.
 *
 * The same human can be both: an Agency operator who is also a member of a
 * Company is one `user_id` wearing two hats, and the two feeds must never
 * merge. So this is a property of the recipient row, not of the person and not
 * of the notification.
 *
 * It is always written explicitly by the publisher that knows its audience,
 * and never inferred from the absence of a `workspace_users` row (§7): that
 * would turn a missing operator record into a client delivery.
 */
export enum NotificationRecipientSurface {
  AGENCY = 'agency',
  CLIENT_AREA = 'client_area',
}

/**
 * NTF-C1 — which surfaces a catalog definition may address.
 *
 * Defaults to `AGENCY` for every existing definition, so the whole catalog
 * keeps its current behaviour with no edit. A definition only reaches the
 * Client Area when it says so.
 */
export enum NotificationAudience {
  AGENCY = 'agency',
  CLIENT_AREA = 'client_area',
  BOTH = 'both',
}
