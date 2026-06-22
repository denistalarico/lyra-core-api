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
import { NotificationDefinition, NotificationDefinitionInput } from '../types';

function define(input: NotificationDefinitionInput): NotificationDefinition {
  const required =
    input.preferencePolicy === NotificationPreferencePolicy.REQUIRED;

  return {
    ...input,
    productKey: input.productKey ?? NotificationProductKey.AGENCY,
    preferenceKey:
      input.preferenceKey ??
      `${input.productKey ?? NotificationProductKey.AGENCY}.${input.moduleKey}.${input.category}`,
    required: input.required ?? required,
    groupable: input.groupable ?? false,
    catalogStatus: input.catalogStatus ?? NotificationCatalogStatus.CATALOGED,
  };
}

function standard(
  eventType: string,
  moduleKey: string,
  category: NotificationCategory,
  recipientStrategy: NotificationRecipientStrategy,
  overrides: Partial<NotificationDefinitionInput> = {},
): NotificationDefinition {
  return define({
    eventType,
    moduleKey,
    category,
    recipientStrategy,
    defaultPriority: NotificationPriority.NORMAL,
    defaultActionType: NotificationActionType.INTERNAL_ROUTE,
    selfNotificationPolicy: NotificationSelfPolicy.SUPPRESS_ACTOR,
    preferencePolicy: NotificationPreferencePolicy.CONFIGURABLE,
    defaultDelivery: NotificationDefaultDelivery.ENABLED,
    ...overrides,
  });
}

function informational(
  eventType: string,
  moduleKey: string,
  category: NotificationCategory,
  recipientStrategy: NotificationRecipientStrategy,
  overrides: Partial<NotificationDefinitionInput> = {},
): NotificationDefinition {
  return standard(eventType, moduleKey, category, recipientStrategy, {
    defaultActionType: NotificationActionType.NONE,
    defaultPriority: NotificationPriority.LOW,
    defaultDelivery: NotificationDefaultDelivery.DISABLED,
    ...overrides,
  });
}

function required(
  eventType: string,
  moduleKey: string,
  category: NotificationCategory,
  recipientStrategy: NotificationRecipientStrategy,
  overrides: Partial<NotificationDefinitionInput> = {},
): NotificationDefinition {
  return standard(eventType, moduleKey, category, recipientStrategy, {
    defaultPriority: NotificationPriority.HIGH,
    preferencePolicy: NotificationPreferencePolicy.REQUIRED,
    defaultDelivery: NotificationDefaultDelivery.ENABLED,
    required: true,
    ...overrides,
  });
}

export const AGENCY_NOTIFICATION_CATALOG: readonly NotificationDefinition[] = [
  // Team Chat
  standard(
    'chat.direct_message_received',
    'team-chat',
    NotificationCategory.MESSAGE,
    NotificationRecipientStrategy.EXPLICIT_USERS,
  ),
  standard(
    'chat.user_mentioned',
    'team-chat',
    NotificationCategory.MENTION,
    NotificationRecipientStrategy.MENTIONED_USERS,
  ),
  standard(
    'chat.channel_mentioned',
    'team-chat',
    NotificationCategory.MENTION,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'chat.thread_replied',
    'team-chat',
    NotificationCategory.MESSAGE,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'chat.channel_invitation_received',
    'team-chat',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.EXPLICIT_USERS,
  ),
  informational(
    'chat.message_pinned',
    'team-chat',
    NotificationCategory.MESSAGE,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'chat.announcement_published',
    'team-chat',
    NotificationCategory.MESSAGE,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'chat.call_invitation_received',
    'team-chat',
    NotificationCategory.MESSAGE,
    NotificationRecipientStrategy.EXPLICIT_USERS,
    {
      defaultPriority: NotificationPriority.HIGH,
      expiresAfterSeconds: 3600,
    },
  ),
  standard(
    'chat.call_started',
    'team-chat',
    NotificationCategory.MESSAGE,
    NotificationRecipientStrategy.PARTICIPANTS,
    {
      expiresAfterSeconds: 3600,
    },
  ),
  standard(
    'chat.call_missed',
    'team-chat',
    NotificationCategory.MESSAGE,
    NotificationRecipientStrategy.EXPLICIT_USERS,
  ),
  standard(
    'chat.message_failed',
    'team-chat',
    NotificationCategory.RISK,
    NotificationRecipientStrategy.REQUESTER,
    {
      defaultPriority: NotificationPriority.HIGH,
    },
  ),
  standard(
    'chat.integration_failed',
    'team-chat',
    NotificationCategory.INTEGRATION,
    NotificationRecipientStrategy.REQUESTER,
    {
      defaultPriority: NotificationPriority.HIGH,
    },
  ),
  standard(
    'chat.ai_summary_failed',
    'team-chat',
    NotificationCategory.PROCESSING,
    NotificationRecipientStrategy.REQUESTER,
    {
      defaultPriority: NotificationPriority.HIGH,
    },
  ),
  standard(
    'chat.recording_ready',
    'team-chat',
    NotificationCategory.PROCESSING,
    NotificationRecipientStrategy.REQUESTER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'chat.transcription_ready',
    'team-chat',
    NotificationCategory.PROCESSING,
    NotificationRecipientStrategy.REQUESTER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'chat.summary_ready',
    'team-chat',
    NotificationCategory.PROCESSING,
    NotificationRecipientStrategy.REQUESTER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),

  // Calendar
  standard(
    'calendar.event_invitation_received',
    'calendar',
    NotificationCategory.CALENDAR,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'calendar.event_updated',
    'calendar',
    NotificationCategory.CALENDAR,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'calendar.event_canceled',
    'calendar',
    NotificationCategory.CALENDAR,
    NotificationRecipientStrategy.PARTICIPANTS,
    {
      defaultPriority: NotificationPriority.HIGH,
    },
  ),
  standard(
    'calendar.event_reminder',
    'calendar',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.PARTICIPANTS,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'calendar.event_starting_soon',
    'calendar',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.PARTICIPANTS,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'calendar.attendee_response_received',
    'calendar',
    NotificationCategory.CALENDAR,
    NotificationRecipientStrategy.RESOURCE_OWNER,
  ),
  standard(
    'calendar.event_rescheduled',
    'calendar',
    NotificationCategory.CALENDAR,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'calendar.recurring_event_changed',
    'calendar',
    NotificationCategory.CALENDAR,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'calendar.conflict_detected',
    'calendar',
    NotificationCategory.RISK,
    NotificationRecipientStrategy.PARTICIPANTS,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),

  // Tasks
  standard(
    'task.assigned',
    'tasks',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.ASSIGNED_USER,
  ),
  standard(
    'task.reassigned',
    'tasks',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.ASSIGNED_USER,
  ),
  standard(
    'task.user_mentioned',
    'tasks',
    NotificationCategory.MENTION,
    NotificationRecipientStrategy.MENTIONED_USERS,
  ),
  informational(
    'task.comment_added',
    'tasks',
    NotificationCategory.COMMENT,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'task.due_soon',
    'tasks',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.ASSIGNED_USER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'task.overdue',
    'tasks',
    NotificationCategory.OVERDUE,
    NotificationRecipientStrategy.ASSIGNED_USER,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'task.completed',
    'tasks',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.RESOURCE_OWNER,
  ),
  standard(
    'task.reopened',
    'tasks',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.ASSIGNED_USER,
  ),
  standard(
    'task.blocked',
    'tasks',
    NotificationCategory.RISK,
    NotificationRecipientStrategy.RESOURCE_OWNER,
    {
      defaultPriority: NotificationPriority.HIGH,
    },
  ),
  informational(
    'task.unblocked',
    'tasks',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.RESOURCE_OWNER,
  ),
  standard(
    'task.checklist_assigned',
    'tasks',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.ASSIGNED_USER,
  ),
  standard(
    'task.approval_requested',
    'tasks',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.APPROVERS,
    {
      defaultPriority: NotificationPriority.HIGH,
    },
  ),
  standard(
    'task.approval_resolved',
    'tasks',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.REQUESTER,
  ),
  informational(
    'task.time_entry_submitted',
    'tasks',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.MANAGERS,
  ),
  standard(
    'task.time_entry_requires_review',
    'tasks',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.APPROVERS,
  ),

  // Projects
  standard(
    'project.member_added',
    'projects',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.EXPLICIT_USERS,
  ),
  informational(
    'project.member_removed',
    'projects',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.EXPLICIT_USERS,
  ),
  standard(
    'project.owner_changed',
    'projects',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.RESOURCE_OWNER,
  ),
  informational(
    'project.status_changed',
    'projects',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'project.deadline_changed',
    'projects',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'project.deadline_at_risk',
    'projects',
    NotificationCategory.RISK,
    NotificationRecipientStrategy.RESOURCE_OWNER,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'project.completed',
    'projects',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  informational(
    'project.archived',
    'projects',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  informational(
    'project.comment_added',
    'projects',
    NotificationCategory.COMMENT,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'project.user_mentioned',
    'projects',
    NotificationCategory.MENTION,
    NotificationRecipientStrategy.MENTIONED_USERS,
  ),
  standard(
    'project.milestone_due_soon',
    'projects',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.PARTICIPANTS,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'project.milestone_completed',
    'projects',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'project.deliverable_ready',
    'projects',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.APPROVERS,
  ),
  standard(
    'project.deliverable_approved',
    'projects',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.REQUESTER,
  ),
  standard(
    'project.deliverable_rejected',
    'projects',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.REQUESTER,
    {
      defaultPriority: NotificationPriority.HIGH,
    },
  ),

  // Clients
  standard(
    'client.assigned',
    'clients',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.ASSIGNED_USER,
  ),
  standard(
    'client.owner_changed',
    'clients',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.RESOURCE_OWNER,
  ),
  informational(
    'client.status_changed',
    'clients',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  informational(
    'client.onboarding_started',
    'clients',
    NotificationCategory.ONBOARDING,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  informational(
    'client.onboarding_completed',
    'clients',
    NotificationCategory.ONBOARDING,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  informational(
    'client.offboarding_started',
    'clients',
    NotificationCategory.OFFBOARDING,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  informational(
    'client.offboarding_completed',
    'clients',
    NotificationCategory.OFFBOARDING,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'client.document_requested',
    'clients',
    NotificationCategory.DOCUMENT,
    NotificationRecipientStrategy.EXPLICIT_USERS,
  ),
  standard(
    'client.document_received',
    'clients',
    NotificationCategory.DOCUMENT,
    NotificationRecipientStrategy.RESOURCE_OWNER,
  ),
  standard(
    'client.contract_expiring',
    'clients',
    NotificationCategory.CONTRACT,
    NotificationRecipientStrategy.RESOURCE_OWNER,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'client.plan_changed',
    'clients',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'client.risk_detected',
    'clients',
    NotificationCategory.RISK,
    NotificationRecipientStrategy.RESOURCE_OWNER,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'client.product_activated',
    'clients',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  informational(
    'client.product_deactivated',
    'clients',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  informational(
    'client.managed_tenant_connected',
    'clients',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.MANAGERS,
  ),
  standard(
    'client.managed_tenant_disconnected',
    'clients',
    NotificationCategory.RISK,
    NotificationRecipientStrategy.MANAGERS,
    {
      defaultPriority: NotificationPriority.HIGH,
    },
  ),

  // Sales
  standard(
    'sales.lead_assigned',
    'sales',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.ASSIGNED_USER,
  ),
  standard(
    'sales.opportunity_assigned',
    'sales',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.ASSIGNED_USER,
  ),
  informational(
    'sales.stage_changed',
    'sales',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'sales.activity_assigned',
    'sales',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.ASSIGNED_USER,
  ),
  standard(
    'sales.activity_due_soon',
    'sales',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.ASSIGNED_USER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'sales.activity_overdue',
    'sales',
    NotificationCategory.OVERDUE,
    NotificationRecipientStrategy.ASSIGNED_USER,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'sales.quote_sent',
    'sales',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.RESOURCE_OWNER,
  ),
  standard(
    'sales.quote_viewed',
    'sales',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.RESOURCE_OWNER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'sales.quote_accepted',
    'sales',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.RESOURCE_OWNER,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'sales.quote_rejected',
    'sales',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.RESOURCE_OWNER,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'sales.quote_expiring',
    'sales',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.RESOURCE_OWNER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'sales.quote_expired',
    'sales',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.RESOURCE_OWNER,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'sales.opportunity_stale',
    'sales',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.ASSIGNED_USER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'sales.forecast_changed',
    'sales',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'sales.revenue_target_at_risk',
    'sales',
    NotificationCategory.RISK,
    NotificationRecipientStrategy.RESPONSIBLE_ROLE,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'sales.recurrence_started',
    'sales',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.RESOURCE_OWNER,
  ),
  standard(
    'sales.deal_won',
    'sales',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  informational(
    'sales.deal_lost',
    'sales',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'sales.user_mentioned',
    'sales',
    NotificationCategory.MENTION,
    NotificationRecipientStrategy.MENTIONED_USERS,
  ),
  standard(
    'sales.contact_assigned',
    'sales',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.ASSIGNED_USER,
  ),
  standard(
    'sales.follow_up_required',
    'sales',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.ASSIGNED_USER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),

  // Finance
  informational(
    'finance.invoice_issued',
    'finance',
    NotificationCategory.FINANCIAL,
    NotificationRecipientStrategy.RESOURCE_OWNER,
  ),
  standard(
    'finance.invoice_due_soon',
    'finance',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.RESPONSIBLE_ROLE,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'finance.invoice_overdue',
    'finance',
    NotificationCategory.OVERDUE,
    NotificationRecipientStrategy.RESPONSIBLE_ROLE,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'finance.invoice_paid',
    'finance',
    NotificationCategory.FINANCIAL,
    NotificationRecipientStrategy.RESOURCE_OWNER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'finance.payment_received',
    'finance',
    NotificationCategory.FINANCIAL,
    NotificationRecipientStrategy.RESPONSIBLE_ROLE,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'finance.payment_failed',
    'finance',
    NotificationCategory.FINANCIAL,
    NotificationRecipientStrategy.RESPONSIBLE_ROLE,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'finance.bill_due_soon',
    'finance',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.RESPONSIBLE_ROLE,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'finance.bill_overdue',
    'finance',
    NotificationCategory.OVERDUE,
    NotificationRecipientStrategy.RESPONSIBLE_ROLE,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'finance.bill_paid',
    'finance',
    NotificationCategory.FINANCIAL,
    NotificationRecipientStrategy.RESPONSIBLE_ROLE,
  ),
  standard(
    'finance.entry_requires_review',
    'finance',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.APPROVERS,
  ),
  standard(
    'finance.entry_approved',
    'finance',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.REQUESTER,
  ),
  standard(
    'finance.cashflow_alert',
    'finance',
    NotificationCategory.RISK,
    NotificationRecipientStrategy.MANAGERS,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'finance.margin_below_threshold',
    'finance',
    NotificationCategory.RISK,
    NotificationRecipientStrategy.MANAGERS,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'finance.reconciliation_required',
    'finance',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.RESPONSIBLE_ROLE,
  ),
  standard(
    'finance.provider_error',
    'finance',
    NotificationCategory.INTEGRATION,
    NotificationRecipientStrategy.RESPONSIBLE_ROLE,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'finance.recurring_charge_created',
    'finance',
    NotificationCategory.FINANCIAL,
    NotificationRecipientStrategy.RESPONSIBLE_ROLE,
  ),
  standard(
    'finance.recurring_charge_failed',
    'finance',
    NotificationCategory.FINANCIAL,
    NotificationRecipientStrategy.RESPONSIBLE_ROLE,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),

  // Contracts
  informational(
    'contract.created',
    'contracts',
    NotificationCategory.CONTRACT,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'contract.review_requested',
    'contracts',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.APPROVERS,
  ),
  standard(
    'contract.approval_requested',
    'contracts',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.APPROVERS,
  ),
  informational(
    'contract.sent_for_signature',
    'contracts',
    NotificationCategory.CONTRACT,
    NotificationRecipientStrategy.REQUESTER,
  ),
  standard(
    'contract.viewed',
    'contracts',
    NotificationCategory.CONTRACT,
    NotificationRecipientStrategy.REQUESTER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'contract.signed',
    'contracts',
    NotificationCategory.CONTRACT,
    NotificationRecipientStrategy.REQUESTER,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'contract.rejected',
    'contracts',
    NotificationCategory.CONTRACT,
    NotificationRecipientStrategy.REQUESTER,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'contract.canceled',
    'contracts',
    NotificationCategory.CONTRACT,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'contract.expiring',
    'contracts',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.RESOURCE_OWNER,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'contract.expired',
    'contracts',
    NotificationCategory.OVERDUE,
    NotificationRecipientStrategy.RESOURCE_OWNER,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'contract.manual_signature_pending',
    'contracts',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.RESPONSIBLE_ROLE,
  ),
  standard(
    'contract.document_generated',
    'contracts',
    NotificationCategory.PROCESSING,
    NotificationRecipientStrategy.REQUESTER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'contract.provider_failed',
    'contracts',
    NotificationCategory.INTEGRATION,
    NotificationRecipientStrategy.REQUESTER,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'contract.version_created',
    'contracts',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'contract.signature_reminder_due',
    'contracts',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.RESPONSIBLE_ROLE,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),

  // Team
  standard(
    'team.member_invited',
    'team',
    NotificationCategory.ONBOARDING,
    NotificationRecipientStrategy.EXPLICIT_USERS,
  ),
  informational(
    'team.member_activated',
    'team',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.MANAGERS,
  ),
  informational(
    'team.member_deactivated',
    'team',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.MANAGERS,
  ),
  informational(
    'team.onboarding_started',
    'team',
    NotificationCategory.ONBOARDING,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'team.onboarding_task_assigned',
    'team',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.ASSIGNED_USER,
  ),
  standard(
    'team.onboarding_step_due',
    'team',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.ASSIGNED_USER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'team.onboarding_completed',
    'team',
    NotificationCategory.ONBOARDING,
    NotificationRecipientStrategy.MANAGERS,
  ),
  informational(
    'team.offboarding_started',
    'team',
    NotificationCategory.OFFBOARDING,
    NotificationRecipientStrategy.MANAGERS,
  ),
  standard(
    'team.contract_expiring',
    'team',
    NotificationCategory.CONTRACT,
    NotificationRecipientStrategy.MANAGERS,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'team.document_requested',
    'team',
    NotificationCategory.DOCUMENT,
    NotificationRecipientStrategy.EXPLICIT_USERS,
  ),
  standard(
    'team.attendance_missing',
    'team',
    NotificationCategory.RISK,
    NotificationRecipientStrategy.EXPLICIT_USERS,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'team.attendance_requires_review',
    'team',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.APPROVERS,
  ),
  standard(
    'team.time_entry_requires_approval',
    'team',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.APPROVERS,
  ),
  standard(
    'team.time_entry_approved',
    'team',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.REQUESTER,
  ),
  standard(
    'team.leave_request_received',
    'team',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.APPROVERS,
  ),
  standard(
    'team.leave_request_resolved',
    'team',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.REQUESTER,
  ),
  informational(
    'team.department_changed',
    'team',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.EXPLICIT_USERS,
  ),
  informational(
    'team.role_changed',
    'team',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.EXPLICIT_USERS,
  ),
  informational(
    'team.skill_assigned',
    'team',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.EXPLICIT_USERS,
  ),

  // Knowledge
  standard(
    'knowledge.article_assigned_for_review',
    'knowledge',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.APPROVERS,
  ),
  informational(
    'knowledge.article_published',
    'knowledge',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  informational(
    'knowledge.article_updated',
    'knowledge',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.WATCHING,
  ),
  standard(
    'knowledge.user_mentioned',
    'knowledge',
    NotificationCategory.MENTION,
    NotificationRecipientStrategy.MENTIONED_USERS,
  ),
  informational(
    'knowledge.comment_added',
    'knowledge',
    NotificationCategory.COMMENT,
    NotificationRecipientStrategy.WATCHING,
  ),
  standard(
    'knowledge.comment_replied',
    'knowledge',
    NotificationCategory.COMMENT,
    NotificationRecipientStrategy.EXPLICIT_USERS,
  ),
  standard(
    'knowledge.article_requires_update',
    'knowledge',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.RESOURCE_OWNER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'knowledge.article_expiring',
    'knowledge',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.RESOURCE_OWNER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'knowledge.review_approved',
    'knowledge',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.RESOURCE_OWNER,
  ),
  standard(
    'knowledge.review_rejected',
    'knowledge',
    NotificationCategory.APPROVAL,
    NotificationRecipientStrategy.RESOURCE_OWNER,
    {
      defaultPriority: NotificationPriority.HIGH,
    },
  ),
  standard(
    'knowledge.onboarding_content_assigned',
    'knowledge',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.ASSIGNED_USER,
  ),
  informational(
    'knowledge.category_changed',
    'knowledge',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.WATCHING,
  ),
  informational(
    'knowledge.article_archived',
    'knowledge',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.WATCHING,
  ),

  // Activities
  standard(
    'activity.assigned',
    'activities',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.ASSIGNED_USER,
  ),
  standard(
    'activity.reassigned',
    'activities',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.ASSIGNED_USER,
  ),
  standard(
    'activity.due_soon',
    'activities',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.ASSIGNED_USER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'activity.reminder',
    'activities',
    NotificationCategory.DEADLINE,
    NotificationRecipientStrategy.ASSIGNED_USER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'activity.overdue',
    'activities',
    NotificationCategory.OVERDUE,
    NotificationRecipientStrategy.ASSIGNED_USER,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'activity.completed',
    'activities',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.RESOURCE_OWNER,
  ),
  informational(
    'activity.canceled',
    'activities',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.PARTICIPANTS,
  ),
  standard(
    'activity.follow_up_created',
    'activities',
    NotificationCategory.ASSIGNMENT,
    NotificationRecipientStrategy.ASSIGNED_USER,
  ),
  standard(
    'activity.user_mentioned',
    'activities',
    NotificationCategory.MENTION,
    NotificationRecipientStrategy.MENTIONED_USERS,
  ),

  // Settings
  standard(
    'settings.user_invited',
    'settings',
    NotificationCategory.ONBOARDING,
    NotificationRecipientStrategy.EXPLICIT_USERS,
  ),
  standard(
    'settings.role_changed',
    'settings',
    NotificationCategory.SECURITY,
    NotificationRecipientStrategy.SECURITY_SUBJECT,
  ),
  standard(
    'settings.permission_changed',
    'settings',
    NotificationCategory.SECURITY,
    NotificationRecipientStrategy.SECURITY_SUBJECT,
  ),
  informational(
    'settings.integration_connected',
    'settings',
    NotificationCategory.INTEGRATION,
    NotificationRecipientStrategy.MANAGERS,
  ),
  standard(
    'settings.integration_disconnected',
    'settings',
    NotificationCategory.INTEGRATION,
    NotificationRecipientStrategy.MANAGERS,
  ),
  standard(
    'settings.integration_error',
    'settings',
    NotificationCategory.INTEGRATION,
    NotificationRecipientStrategy.MANAGERS,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'settings.domain_verified',
    'settings',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.MANAGERS,
  ),
  standard(
    'settings.domain_verification_failed',
    'settings',
    NotificationCategory.RISK,
    NotificationRecipientStrategy.MANAGERS,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  informational(
    'settings.company_profile_changed',
    'settings',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.MANAGERS,
  ),
  informational(
    'settings.notification_preferences_changed',
    'settings',
    NotificationCategory.STATUS,
    NotificationRecipientStrategy.REQUESTER,
  ),
  required(
    'settings.product_entitlement_changed',
    'settings',
    NotificationCategory.SECURITY,
    NotificationRecipientStrategy.MANAGERS,
  ),

  // Security
  required(
    'security.new_login_detected',
    'security',
    NotificationCategory.SECURITY,
    NotificationRecipientStrategy.SECURITY_SUBJECT,
  ),
  required(
    'security.password_changed',
    'security',
    NotificationCategory.SECURITY,
    NotificationRecipientStrategy.SECURITY_SUBJECT,
  ),
  required(
    'security.two_factor_enabled',
    'security',
    NotificationCategory.SECURITY,
    NotificationRecipientStrategy.SECURITY_SUBJECT,
  ),
  required(
    'security.two_factor_disabled',
    'security',
    NotificationCategory.SECURITY,
    NotificationRecipientStrategy.SECURITY_SUBJECT,
    {
      defaultPriority: NotificationPriority.CRITICAL,
    },
  ),
  required(
    'security.recovery_codes_regenerated',
    'security',
    NotificationCategory.SECURITY,
    NotificationRecipientStrategy.SECURITY_SUBJECT,
  ),
  required(
    'security.suspicious_activity_detected',
    'security',
    NotificationCategory.SECURITY,
    NotificationRecipientStrategy.SECURITY_SUBJECT,
    {
      defaultPriority: NotificationPriority.CRITICAL,
    },
  ),
  required(
    'security.session_revoked',
    'security',
    NotificationCategory.SECURITY,
    NotificationRecipientStrategy.SECURITY_SUBJECT,
  ),
  required(
    'security.email_changed',
    'security',
    NotificationCategory.SECURITY,
    NotificationRecipientStrategy.SECURITY_SUBJECT,
  ),
  required(
    'security.account_locked',
    'security',
    NotificationCategory.SECURITY,
    NotificationRecipientStrategy.SECURITY_SUBJECT,
    {
      defaultPriority: NotificationPriority.CRITICAL,
    },
  ),

  // System
  standard(
    'system.import_completed',
    'system',
    NotificationCategory.PROCESSING,
    NotificationRecipientStrategy.REQUESTER,
    {
      productKey: NotificationProductKey.PLATFORM,
      selfNotificationPolicy: NotificationSelfPolicy.ACTOR_ONLY,
    },
  ),
  standard(
    'system.import_failed',
    'system',
    NotificationCategory.PROCESSING,
    NotificationRecipientStrategy.REQUESTER,
    {
      productKey: NotificationProductKey.PLATFORM,
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ACTOR_ONLY,
    },
  ),
  standard(
    'system.export_ready',
    'system',
    NotificationCategory.PROCESSING,
    NotificationRecipientStrategy.REQUESTER,
    {
      productKey: NotificationProductKey.PLATFORM,
      selfNotificationPolicy: NotificationSelfPolicy.ACTOR_ONLY,
    },
  ),
  standard(
    'system.export_failed',
    'system',
    NotificationCategory.PROCESSING,
    NotificationRecipientStrategy.REQUESTER,
    {
      productKey: NotificationProductKey.PLATFORM,
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ACTOR_ONLY,
    },
  ),
  standard(
    'system.pdf_generated',
    'system',
    NotificationCategory.PROCESSING,
    NotificationRecipientStrategy.REQUESTER,
    {
      productKey: NotificationProductKey.PLATFORM,
      selfNotificationPolicy: NotificationSelfPolicy.ACTOR_ONLY,
    },
  ),
  standard(
    'system.pdf_generation_failed',
    'system',
    NotificationCategory.PROCESSING,
    NotificationRecipientStrategy.REQUESTER,
    {
      productKey: NotificationProductKey.PLATFORM,
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ACTOR_ONLY,
    },
  ),
  standard(
    'system.sync_completed',
    'system',
    NotificationCategory.PROCESSING,
    NotificationRecipientStrategy.REQUESTER,
    {
      productKey: NotificationProductKey.PLATFORM,
      selfNotificationPolicy: NotificationSelfPolicy.ACTOR_ONLY,
    },
  ),
  standard(
    'system.sync_failed',
    'system',
    NotificationCategory.PROCESSING,
    NotificationRecipientStrategy.REQUESTER,
    {
      productKey: NotificationProductKey.PLATFORM,
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ACTOR_ONLY,
    },
  ),
  standard(
    'system.background_job_failed',
    'system',
    NotificationCategory.SYSTEM,
    NotificationRecipientStrategy.MANAGERS,
    {
      productKey: NotificationProductKey.PLATFORM,
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'system.storage_limit_warning',
    'system',
    NotificationCategory.RISK,
    NotificationRecipientStrategy.MANAGERS,
    {
      productKey: NotificationProductKey.PLATFORM,
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  required(
    'system.product_entitlement_changed',
    'system',
    NotificationCategory.SECURITY,
    NotificationRecipientStrategy.MANAGERS,
    {
      productKey: NotificationProductKey.PLATFORM,
    },
  ),
  standard(
    'system.integration_token_expiring',
    'system',
    NotificationCategory.INTEGRATION,
    NotificationRecipientStrategy.MANAGERS,
    {
      productKey: NotificationProductKey.PLATFORM,
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'system.integration_token_expired',
    'system',
    NotificationCategory.INTEGRATION,
    NotificationRecipientStrategy.MANAGERS,
    {
      productKey: NotificationProductKey.PLATFORM,
      defaultPriority: NotificationPriority.CRITICAL,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),

  // Dashboards
  standard(
    'dashboard.report_ready',
    'dashboards',
    NotificationCategory.PROCESSING,
    NotificationRecipientStrategy.REQUESTER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ACTOR_ONLY,
    },
  ),
  standard(
    'dashboard.alert_generated',
    'dashboards',
    NotificationCategory.RISK,
    NotificationRecipientStrategy.MANAGERS,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'dashboard.threshold_exceeded',
    'dashboards',
    NotificationCategory.RISK,
    NotificationRecipientStrategy.MANAGERS,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'dashboard.risk_detected',
    'dashboards',
    NotificationCategory.RISK,
    NotificationRecipientStrategy.MANAGERS,
    {
      defaultPriority: NotificationPriority.HIGH,
      selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    },
  ),
  standard(
    'dashboard.digest_ready',
    'dashboards',
    NotificationCategory.PROCESSING,
    NotificationRecipientStrategy.REQUESTER,
    {
      selfNotificationPolicy: NotificationSelfPolicy.ACTOR_ONLY,
    },
  ),
];
