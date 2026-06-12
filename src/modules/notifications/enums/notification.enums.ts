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
