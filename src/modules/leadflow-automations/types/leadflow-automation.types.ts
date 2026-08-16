import { LeadFlowAutomationCategory } from '../enums/leadflow-automation-category.enum';
import { LeadFlowAutomationReadinessState } from '../enums/leadflow-automation-readiness-state.enum';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';

export type LeadFlowJsonValue =
  | string
  | number
  | boolean
  | null
  | LeadFlowJsonValue[]
  | { [key: string]: LeadFlowJsonValue };

export type LeadFlowJsonObject = Record<string, LeadFlowJsonValue>;

/**
 * Foreseen trigger keys (blueprint section 10). This is a contract-only union:
 * no runtime consumes it yet. `schedule.daily` and `contact.special_date`
 * extend the blueprint list to honestly model the two date-based optional
 * recipes (daily summary, birthday) without pretending they use another event.
 */
export type LeadFlowAutomationTrigger =
  | 'conversation.created'
  | 'conversation.idle'
  | 'conversation.replied'
  | 'conversation.handoff_requested'
  | 'opportunity.created'
  | 'opportunity.updated'
  | 'opportunity.stage_changed'
  | 'opportunity.score_changed'
  | 'opportunity.hot_lead_detected'
  | 'opportunity.won'
  | 'opportunity.missing_fields_detected'
  | 'appointment.created'
  | 'appointment.confirmation_pending'
  | 'appointment.no_show'
  | 'appointment.completed'
  | 'quote.sent'
  | 'quote.idle'
  | 'business_hours.closed'
  | 'developer.webhook.received'
  | 'schedule.daily'
  | 'contact.special_date';

/** Action keys exposed by the governed automation contract. */
export type LeadFlowAutomationAction =
  | 'send_message'
  | 'schedule_followup'
  /** Persists the timers that deliver an appointment's reminders. */
  | 'schedule_appointment_reminder'
  | 'notify_user'
  | 'move_opportunity_stage'
  | 'assign_opportunity_owner'
  | 'transfer_opportunity_pipeline'
  | 'copy_opportunity'
  | 'update_opportunity_score'
  | 'add_tag'
  | 'request_missing_fields'
  | 'request_handoff'
  | 'create_task'
  | 'send_webhook'
  | 'append_note'
  | 'request_csat'
  | 'generate_summary_placeholder';

export interface LeadFlowAutomationTriggerConfig {
  type?: LeadFlowAutomationTrigger;
  /** Idle delay before firing (e.g. follow-up de lead sem resposta). */
  delayHours?: number | null;
  /** Time an opportunity has been sitting on a stage. */
  idleHoursInStage?: number;
  pipelineRef?: string | null;
  stageRef?: string | null;
  [key: string]: LeadFlowJsonValue | undefined;
}

export interface LeadFlowAutomationConditionConfig {
  businessHoursOnly?: boolean | null;
  /** Never relaxes a global consent requirement during resolution. */
  requireExplicitConsent?: boolean | null;
  stopIfReplied?: boolean;
  stopIfHandoff?: boolean;
  minScore?: number;
  intents?: string[];
  keywords?: string[];
  requiredFields?: string[];
  /** Independent tag rules evaluated by automatic tagging. */
  tagRules?: LeadFlowTagRuleConfig[];
  [key: string]: LeadFlowJsonValue | undefined;
}

export type LeadFlowTagRuleOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'is_present';

/**
 * One tagging decision: a comparison against a canonical CRM opportunity field,
 * and the tags it applies when the comparison holds.
 *
 * The tags belong to the rule rather than to the automation because the rules
 * are independent — two rules that matched apply their own tags, and a rule
 * that did not match applies none.
 */
export type LeadFlowTagRuleConfig = LeadFlowJsonObject & {
  /** Canonical opportunity field path, as declared by the CRM field catalog. */
  field: string;
  operator: LeadFlowTagRuleOperator;
  /** Compared value; always `null` for `is_present`. */
  value?: string | null;
  /** CRM tag ids, revalidated in the workspace before any is applied. */
  tagIds: string[];
};

export interface LeadFlowAutomationActionConfig {
  primaryAction?: LeadFlowAutomationAction;
  maxAttempts?: number | null;
  moveToStageRef?: string | null;
  targetUserRef?: string | null;
  notifyOpportunityOwner?: boolean;
  notifyPipelineOwner?: boolean;
  notifyPipelineParticipants?: boolean;
  specificRecipientUserRefs?: string[];
  notificationChannels?: LeadFlowHotLeadNotificationChannel[];
  requireHumanApproval?: boolean;
  /** Rule the lead-distribution action uses to pick a participant. */
  distributionStrategy?: 'least_volume' | 'round_robin' | 'by_channel';
  /** Source-channel → user, for the `by_channel` distribution strategy. */
  distributionChannelMap?: Record<string, string>;
  /** Preferred assignee when a distribution strategy cannot resolve one. */
  distributionFallbackUserRef?: string | null;
  [key: string]: LeadFlowJsonValue | undefined;
}

export type LeadFlowHotLeadNotificationChannel =
  | 'in_app'
  | 'push'
  | 'platform_whatsapp'
  | 'email'
  | 'sms';

export interface LeadFlowAutomationMessageConfig {
  channel?: string | null;
  templateRef?: string | null;
  templateLanguage?: string | null;
  baseMessage?: string;
  quickReplies?: string[];
  /**
   * Channel policy for the two productive follow-up recipes.
   *
   * It remains in the existing jsonb message_config column: connection
   * references are opaque ids and credentials never cross this contract.
   */
  followupSteps?: LeadFlowFollowupStepConfig[];
  [key: string]: LeadFlowJsonValue | undefined;
}

export type LeadFlowFollowupChannel =
  | 'whatsapp'
  | 'email'
  | 'sms'
  | 'facebook_messenger'
  | 'instagram_direct'
  | 'webchat';

/**
 * Governed defaults shared by automations in one LeadFlow Settings context.
 * The shape is deliberately closed by the global-config service.
 */
export interface LeadFlowAutomationGlobalDefaults {
  schemaVersion: 1;
  timezone: string;
  businessHours: {
    enabled: boolean;
    /** Optional windows keyed by ISO weekday (mon..sun). */
    windows: Partial<
      Record<
        'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun',
        { start: string; end: string }
      >
    >;
  };
  crm: {
    pipelineRef: string | null;
    stageRef: string | null;
  };
  channels: {
    defaultChannel: LeadFlowFollowupChannel | null;
  };
  consent: {
    requireExplicitConsent: boolean;
  };
  followUp: {
    defaultDelayHours: number | null;
    maxAttempts: number | null;
  };
}

export interface LeadFlowAutomationGlobalDefaultsSnapshot {
  version: number;
  source: 'fallback' | 'persisted';
  createdAt: string | null;
  config: LeadFlowAutomationGlobalDefaults;
}

export type LeadFlowWhatsappTemplateReferenceStatus =
  | 'not_configured'
  | 'pending_validation'
  | 'valid'
  | 'not_found'
  | 'not_approved'
  | 'language_mismatch'
  | 'components_unsupported';

export type LeadFlowWhatsappTemplateReference = LeadFlowJsonObject & {
  providerTemplateName: string;
  languageCode: string;
  status?: LeadFlowWhatsappTemplateReferenceStatus;
};

export type LeadFlowFollowupChannelConfig = LeadFlowJsonObject & {
  channel: LeadFlowFollowupChannel;
  enabled: boolean;
  outsideWindowEnabled: boolean;
  connectionRef?: string | null;
  whatsappTemplate?: LeadFlowWhatsappTemplateReference;
};

export type LeadFlowFollowupStepConfig = LeadFlowJsonObject & {
  stepKey: string;
  delayMinutes: number;
  channels: LeadFlowFollowupChannelConfig[];
};

export type LeadFlowFollowupChannelResult =
  | 'sent'
  | 'skipped_outside_messaging_window'
  | 'skipped_template_required'
  | 'skipped_template_invalid'
  | 'skipped_template_language_mismatch'
  | 'skipped_template_components_unsupported'
  | 'skipped_email_opt_out'
  | 'skipped_email_missing_consent'
  | 'skipped_sms_opt_out'
  | 'skipped_sms_missing_consent'
  | 'skipped_channel_unavailable'
  | 'skipped_recipient_unavailable'
  /** The contact refused outbound contact; only the attempts that reach out. */
  | 'skipped_contact_opt_out'
  /** A manual card whose text for this attempt was never written. */
  | 'skipped_message_unavailable'
  | 'failed_provider';

/**
 * Per-automation CRM behaviour. The *structural* rule "every conversation
 * creates/links a CRM opportunity" is NOT configured here — it lives at the
 * context contract level (`structuralRules`) and is always on.
 */
export interface LeadFlowAutomationCrmPolicy {
  moveStageOnComplete?: string | null;
  moveStageReasonCode?: string | null;
  transferToPipelineRef?: string | null;
  transferToStageRef?: string | null;
  transferReasonCode?: string | null;
  copyToPipelineRef?: string | null;
  copyToStageRef?: string | null;
  copyReasonCode?: string | null;
  updateScore?: boolean;
  addTags?: string[];
  appendNote?: boolean;
  [key: string]: LeadFlowJsonValue | undefined;
}

/** Documented shape of a schedule offset entry (stored as a plain JSON object). */
export interface LeadFlowAutomationScheduleOffset {
  label: string;
  minutesBefore: number;
}

export interface LeadFlowAutomationSchedulePolicy {
  respectBusinessHours?: boolean | null;
  timezone?: string | null;
  /** Local wall-clock time (HH:mm) used by recurring daily automations. */
  dailyTime?: string;
  /** How long a pending CSAT request remains answerable. */
  responseWindowHours?: number;
  /** Array of `{ label, minutesBefore }` objects (see {@link LeadFlowAutomationScheduleOffset}). */
  offsets?: LeadFlowJsonObject[];
  cooldownHours?: number;
  /**
   * A weekly schedule of this automation's own, in the same shape the Inbox
   * settings persist. Null inherits the workspace's.
   */
  businessHours?: LeadFlowBusinessHoursScheduleConfig | null;
  [key: string]: LeadFlowJsonValue | undefined;
}

export type LeadFlowBusinessHoursDayConfig = LeadFlowJsonObject & {
  day: string;
  enabled: boolean;
  /** `HH:MM`, local to the schedule's time zone. */
  start: string;
  end: string;
};

export type LeadFlowBusinessHoursScheduleConfig = LeadFlowJsonObject & {
  enabled: boolean;
  timezone: string;
  days: LeadFlowBusinessHoursDayConfig[];
};

export interface LeadFlowAutomationDeveloperConfig {
  enabled?: boolean;
  advancedConditions?: LeadFlowJsonObject;
  dryRunEnabled?: boolean;
  [key: string]: LeadFlowJsonValue | undefined;
}

export type LeadFlowAutomationWebhookDirection = 'outgoing' | 'incoming';
export type LeadFlowAutomationWebhookMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE';

/**
 * Developer webhook configuration. The raw `secret` is persisted server-side
 * but is NEVER returned by any endpoint — response/runtime mappers strip it and
 * expose only `secretMasked` / `hasSecret`. See {@link LeadFlowAutomationWebhookPublic}.
 */
export interface LeadFlowAutomationWebhookConfig {
  enabled?: boolean;
  direction?: LeadFlowAutomationWebhookDirection | null;
  url?: string | null;
  method?: LeadFlowAutomationWebhookMethod;
  headers?: LeadFlowJsonObject;
  payloadMapping?: LeadFlowJsonObject;
  /**
   * Event names from the LeadFlow event catalog this endpoint subscribes to.
   *
   * The subscription lives here rather than in the recipe's `trigger` because
   * one endpoint listens to many events — which is what every webhook product
   * does, and what the single-trigger field cannot express.
   */
  events?: string[];
  /**
   * Payload fields to send, per event name. `['*']` — or an absent entry —
   * means the whole payload, so a contract that grows later keeps flowing.
   */
  payloadFields?: LeadFlowJsonObject;
  /** Read and record the endpoint's JSON answer instead of only its status. */
  expectJsonResponse?: boolean;
  /** Raw secret/token. Persisted, never serialized to a response. */
  secret?: string | null;
  /** `{ maxRetries, backoffSeconds }` stored as a plain JSON object. */
  retryPolicy?: LeadFlowJsonObject;
  [key: string]: LeadFlowJsonValue | undefined;
}

/** Masked, safe-to-serialize projection of a webhook config. */
export interface LeadFlowAutomationWebhookPublic {
  enabled: boolean;
  direction: LeadFlowAutomationWebhookDirection | null;
  url: string | null;
  method: LeadFlowAutomationWebhookMethod | null;
  headers: LeadFlowJsonObject;
  payloadMapping: LeadFlowJsonObject;
  events: string[];
  payloadFields: LeadFlowJsonObject;
  expectJsonResponse: boolean;
  hasSecret: boolean;
  secretMasked: string | null;
  retryPolicy: {
    maxRetries: number;
    backoffSeconds: number;
  };
}

export interface LeadFlowAutomationReadiness {
  score?: number;
  level?: 'not_ready' | 'partial' | 'ready';
  state?: LeadFlowAutomationReadinessState;
  missing?: string[];
  checkedAt?: string;
  [key: string]: LeadFlowJsonValue | undefined;
}

/**
 * Clean, predictable runtime contract for a single automation. Pure data
 * envelope — no AI, no queue, no message dispatch. A future runtime consumes
 * this to decide what to do when the trigger fires.
 */
export interface LeadFlowAutomationRuntimeContract {
  version: number;
  generatedAt: string;
  tenantId: string;
  workspaceId: string;
  automationId: string;
  recipeKey: string | null;
  name: string;
  category: LeadFlowAutomationCategory | string;
  status: LeadFlowAutomationStatus;
  businessMode: {
    key: string;
    isCustom: boolean;
  };
  leadflowSettingsSnapshot: {
    settingsId: string | null;
    contextType: string;
    status: string;
    planKey: string | null;
    developerModeEnabled: boolean;
  };
  /** Defaults and version actually used to resolve this runtime contract. */
  globalDefaults: LeadFlowAutomationGlobalDefaultsSnapshot;
  /** Values supplied by global defaults rather than this instance. */
  inheritedFields: string[];
  trigger: LeadFlowAutomationTriggerConfig;
  conditions: LeadFlowAutomationConditionConfig;
  actions: LeadFlowAutomationActionConfig;
  message: LeadFlowAutomationMessageConfig;
  crmPolicy: LeadFlowAutomationCrmPolicy;
  schedulePolicy: LeadFlowAutomationSchedulePolicy;
  /** Developer flags only. Secrets are masked (see webhook). */
  developerConfig: LeadFlowJsonObject;
  /** Masked webhook contract; `null` when no webhook is configured. */
  webhook: LeadFlowAutomationWebhookPublic | null;
  safetyRules: string[];
  readiness: LeadFlowAutomationReadiness;
  publishedVersionId: string | null;
  /** Immutable snapshot version currently reviewed by the operator. */
  publication?: {
    currentVersion: number;
    nextVersion: number;
  };
}

/** The structural, non-optional LeadFlow rule surfaced in every context contract. */
export interface LeadFlowAutomationStructuralRules {
  everyConversationCreatesOpportunity: true;
  description: string;
}

/**
 * Context-level runtime contract: shared settings/business-mode envelope, the
 * structural rules, and the contract of every active automation in scope.
 */
export interface LeadFlowAutomationsRuntimeContract {
  version: number;
  generatedAt: string;
  tenantId: string;
  workspaceId: string;
  businessMode: LeadFlowAutomationRuntimeContract['businessMode'];
  leadflowSettingsSnapshot: LeadFlowAutomationRuntimeContract['leadflowSettingsSnapshot'];
  globalDefaults: LeadFlowAutomationGlobalDefaultsSnapshot;
  structuralRules: LeadFlowAutomationStructuralRules;
  enabledAutomations: LeadFlowAutomationRuntimeContract[];
}
