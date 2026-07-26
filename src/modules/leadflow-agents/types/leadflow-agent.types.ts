import { LeadFlowAgentStatus } from '../enums/leadflow-agent-status.enum';
import { LeadFlowAgentType } from '../enums/leadflow-agent-type.enum';

export type LeadFlowJsonValue =
  | string
  | number
  | boolean
  | null
  | LeadFlowJsonValue[]
  | { [key: string]: LeadFlowJsonValue };

export type LeadFlowJsonObject = Record<string, LeadFlowJsonValue>;

/**
 * Behaviour tuning for an agent (tone, latency, escalation posture). This is
 * safe, non-developer configuration exposed to common users.
 */
export interface LeadFlowAgentBehaviorConfig {
  tone?: string | string[];
  language?: string;
  allowedLanguages?: string[];
  roleTitle?: string;
  formality?: 'informal' | 'balanced' | 'formal';
  introductionPolicy?: 'never' | 'first_reply' | 'when_asked';
  aiDisclosure?: string;
  preferredClosing?: string;
  behaviorLimits?: string[];
  proactivity?: 'low' | 'balanced' | 'high';
  responseStyle?: string | string[];
  guardrails?: string[];
  /**
   * Who this agent serves: leads, customers, or both. Stored here (in the
   * behaviour config jsonb) as a stable technical field; resolved via
   * `resolveServiceAudience` with a safe default. Internal users are never served
   * regardless of this value.
   */
  serviceAudience?: 'leads' | 'customers' | 'leads_and_customers';
  [key: string]: LeadFlowJsonValue | undefined;
}

/**
 * Prompt policy that intentionally NEVER exposes a raw system prompt to common
 * users. Raw overrides are gated behind developer permission and live under
 * `developerOverrides`, which is only ever populated when a developer edits it.
 */
export interface LeadFlowAgentPromptConfig {
  platformSystemPromptRef?: string;
  businessModePromptRef?: string;
  clientPromptConfigRef?: string;
  variables?: string[];
  /** Only present/editable with developer permission. */
  developerOverrides?: LeadFlowJsonObject;
  [key: string]: LeadFlowJsonValue | undefined;
}

export interface LeadFlowAgentHandoffPolicy {
  triggers?: string[];
  target?: string;
  slaMinutes?: number;
  transferOpportunityOnHandoff?: boolean;
  targetPipelineId?: string | null;
  targetStageId?: string | null;
  [key: string]: LeadFlowJsonValue | undefined;
}

export interface LeadFlowAgentCrmPolicy {
  pipelineRef?: LeadFlowJsonObject;
  createLeads?: boolean;
  updateStageOnQualified?: boolean;
  qualificationFields?: LeadFlowJsonObject[];
  [key: string]: LeadFlowJsonValue | undefined;
}

export interface LeadFlowAgentChannelPolicy {
  allowedChannels?: string[];
  defaultChannel?: string | null;
  activationPolicy?: {
    version: 1;
    trigger: 'manual' | 'every_eligible' | 'keywords' | 'ad_referral';
    keywords?: string[];
    keywordMode?: 'word' | 'phrase_contains';
    adFilters?: {
      accountId?: string[];
      campaignId?: string[];
      adId?: string[];
    };
    expiresAfterMinutes?: number;
    afterHandoff?: 'require_explicit_return';
    automaticEffects?: { reply: false; crm: false; followUp: false };
  };
  [key: string]: LeadFlowJsonValue | undefined;
}

export interface LeadFlowAgentAvatarConfig {
  preset?: string;
  skin?: string;
  outfit?: string;
  accentColor?: string;
  icon?: string;
  [key: string]: LeadFlowJsonValue | undefined;
}

export interface LeadFlowAgentReadiness {
  score?: number;
  level?: 'not_ready' | 'partial' | 'ready';
  missing?: string[];
  checkedAt?: string;
  [key: string]: LeadFlowJsonValue | undefined;
}

/**
 * Clean runtime contract returned by the runtime-config endpoints. This is a
 * pure data envelope: no AI is executed, no prompt is rendered. A future
 * runtime consumes this to build and drive an agent.
 */
export interface LeadFlowAgentRuntimeContract {
  version: number;
  generatedAt: string;
  tenantId: string;
  workspaceId: string;
  leadflowSettingsSnapshot: {
    settingsId: string | null;
    contextType: string;
    status: string;
    planKey: string | null;
    developerModeEnabled: boolean;
  };
  businessMode: {
    key: string;
    isCustom: boolean;
  };
  clientPromptConfigSnapshot: LeadFlowJsonObject;
  agentIdentity: {
    agentId: string;
    name: string;
    type: LeadFlowAgentType;
    presetKey: string | null;
    status: LeadFlowAgentStatus;
    isSystem: boolean;
    isCustom: boolean;
    avatar: LeadFlowAgentAvatarConfig;
    roleTitle: string | null;
    primaryLanguage: string;
    allowedLanguages: string[];
    introductionPolicy: string;
    aiDisclosure: string;
  };
  behavior: LeadFlowAgentBehaviorConfig;
  promptPolicy: LeadFlowAgentPromptConfig;
  channelBindings: Array<{
    channelKey: string;
    provider: string | null;
    externalRef: string | null;
    status: string;
    config: LeadFlowJsonObject;
  }>;
  crmPolicy: LeadFlowAgentCrmPolicy;
  handoffPolicy: LeadFlowAgentHandoffPolicy;
  allowedActions: string[];
  /**
   * The formal role policy for this agent's type: what it is for and exactly
   * which commercial decision actions it may attempt. This is the authoritative
   * per-type permission the runtime enforces, surfaced so a consumer never has
   * to re-derive it from the agent's free configuration.
   */
  role: {
    type: LeadFlowAgentType;
    roleTitle: string;
    objective: string;
    allowedDecisionActions: string[];
    canProposeStageTransition: boolean;
  };
  /** Whether the agent can actually run, and what is missing if it cannot. */
  readiness: LeadFlowAgentReadiness;
  /**
   * The commercial audience this agent serves (leads / customers / both). An
   * internal user is never served, whatever this says — that is enforced by the
   * contact-relationship rule, not by this field.
   */
  serviceAudience: 'leads' | 'customers' | 'leads_and_customers';
  safetyRules: string[];
  publishedVersionId: string | null;
}
