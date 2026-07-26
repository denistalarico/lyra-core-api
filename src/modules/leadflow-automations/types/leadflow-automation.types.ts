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
  | 'generate_summary_placeholder';

export interface LeadFlowAutomationTriggerConfig {
  type?: LeadFlowAutomationTrigger;
  /** Idle delay before firing (e.g. follow-up de lead sem resposta). */
  delayHours?: number;
  /** Time an opportunity has been sitting on a stage. */
  idleHoursInStage?: number;
  pipelineRef?: string | null;
  stageRef?: string | null;
  [key: string]: LeadFlowJsonValue | undefined;
}

export interface LeadFlowAutomationConditionConfig {
  businessHoursOnly?: boolean;
  stopIfReplied?: boolean;
  stopIfHandoff?: boolean;
  minScore?: number;
  intents?: string[];
  keywords?: string[];
  requiredFields?: string[];
  [key: string]: LeadFlowJsonValue | undefined;
}

export interface LeadFlowAutomationActionConfig {
  primaryAction?: LeadFlowAutomationAction;
  maxAttempts?: number;
  moveToStageRef?: string | null;
  targetUserRef?: string | null;
  addTags?: string[];
  requireHumanApproval?: boolean;
  /** Rule the lead-distribution action uses to pick a participant. */
  distributionStrategy?: 'least_volume' | 'round_robin' | 'by_channel';
  /** Source-channel → user, for the `by_channel` distribution strategy. */
  distributionChannelMap?: Record<string, string>;
  /** Preferred assignee when a distribution strategy cannot resolve one. */
  distributionFallbackUserRef?: string | null;
  [key: string]: LeadFlowJsonValue | undefined;
}

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
  respectBusinessHours?: boolean;
  timezone?: string | null;
  /** Array of `{ label, minutesBefore }` objects (see {@link LeadFlowAutomationScheduleOffset}). */
  offsets?: LeadFlowJsonObject[];
  cooldownHours?: number;
  [key: string]: LeadFlowJsonValue | undefined;
}

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
  structuralRules: LeadFlowAutomationStructuralRules;
  enabledAutomations: LeadFlowAutomationRuntimeContract[];
}
