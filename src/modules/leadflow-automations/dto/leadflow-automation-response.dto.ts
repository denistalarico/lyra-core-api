import {
  getRecipeByKey,
  isRecipeCompatible,
} from '../catalog/automation-recipes.catalog';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import { LeadFlowAutomationCategory } from '../enums/leadflow-automation-category.enum';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import type {
  LeadFlowAutomationActionConfig,
  LeadFlowAutomationConditionConfig,
  LeadFlowAutomationCrmPolicy,
  LeadFlowAutomationMessageConfig,
  LeadFlowAutomationReadiness,
  LeadFlowAutomationSchedulePolicy,
  LeadFlowAutomationTrigger,
  LeadFlowAutomationTriggerConfig,
  LeadFlowAutomationWebhookConfig,
  LeadFlowAutomationWebhookPublic,
  LeadFlowJsonObject,
} from '../types/leadflow-automation.types';

/**
 * Projects a stored webhook config into a masked, safe-to-serialize shape.
 * The raw `secret` is NEVER included — only whether it exists and its last 4
 * characters. Returns `null` when no meaningful webhook config is present.
 */
export function maskWebhookConfig(
  config: LeadFlowAutomationWebhookConfig | null | undefined,
): LeadFlowAutomationWebhookPublic | null {
  if (!config || typeof config !== 'object') {
    return null;
  }

  const hasContent =
    config.enabled === true ||
    Boolean(config.direction) ||
    Boolean(config.url) ||
    Boolean(config.secret) ||
    (config.headers && Object.keys(config.headers).length > 0);

  if (!hasContent) {
    return null;
  }

  const secret = typeof config.secret === 'string' ? config.secret : null;
  const secretMasked =
    secret && secret.length > 0
      ? `••••${secret.slice(-4)}`
      : null;

  const retry = (config.retryPolicy ?? {}) as LeadFlowJsonObject;

  return {
    enabled: config.enabled === true,
    direction: config.direction ?? null,
    url: config.url ?? null,
    method: config.method ?? null,
    headers: (config.headers as LeadFlowJsonObject) ?? {},
    payloadMapping: (config.payloadMapping as LeadFlowJsonObject) ?? {},
    hasSecret: Boolean(secret),
    secretMasked,
    retryPolicy: {
      maxRetries: readNumber(retry.maxRetries),
      backoffSeconds: readNumber(retry.backoffSeconds),
    },
  };
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export interface LeadFlowAutomationSummaryResponse {
  id: string;
  recipeKey: string;
  name: string;
  description: string | null;
  category: LeadFlowAutomationCategory;
  tier: string;
  status: LeadFlowAutomationStatus;
  businessModeKey: string;
  triggerType: LeadFlowAutomationTrigger | string;
  primaryAction: string;
  isDeveloperRecipe: boolean;
  compatibleWithBusinessMode: boolean;
  readiness: LeadFlowAutomationReadiness;
  publishedVersionId: string | null;
  updatedAt: string;
}

export interface LeadFlowAutomationCapabilities {
  /** Whether the caller may edit developer/webhook config and run dry-runs. */
  developer: boolean;
}

export interface LeadFlowAutomationDetailResponse
  extends LeadFlowAutomationSummaryResponse {
  contextType: string;
  agencyClientId: string | null;
  settingsId: string | null;
  capabilities: LeadFlowAutomationCapabilities;
  whenLabel: string | null;
  limitsLabel: string | null;
  triggerConfig: LeadFlowAutomationTriggerConfig;
  conditionConfig: LeadFlowAutomationConditionConfig;
  actionConfig: LeadFlowAutomationActionConfig;
  messageConfig: LeadFlowAutomationMessageConfig;
  crmPolicy: LeadFlowAutomationCrmPolicy;
  schedulePolicy: LeadFlowAutomationSchedulePolicy;
  developerConfig: LeadFlowJsonObject;
  webhook: LeadFlowAutomationWebhookPublic | null;
  safetyRules: string[];
  metadata: LeadFlowJsonObject;
  createdAt: string;
}

export interface LeadFlowAutomationListResponse {
  items: LeadFlowAutomationSummaryResponse[];
  businessModeKey: string;
  isCustomBusinessMode: boolean;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

export function mapAutomationSummary(
  automation: LeadFlowAutomationEntity,
): LeadFlowAutomationSummaryResponse {
  const recipe = getRecipeByKey(automation.recipeKey);

  return {
    id: automation.id,
    recipeKey: automation.recipeKey,
    name: automation.name,
    description: automation.description,
    category: automation.category,
    tier: recipe?.tier ?? 'optional',
    status: automation.status,
    businessModeKey: automation.businessModeKey,
    triggerType:
      (automation.triggerConfig?.type as LeadFlowAutomationTrigger) ??
      recipe?.trigger ??
      'conversation.created',
    primaryAction:
      (automation.actionConfig?.primaryAction as string) ??
      recipe?.primaryAction ??
      'send_message',
    isDeveloperRecipe:
      recipe?.isDeveloperOnly ??
      automation.category === LeadFlowAutomationCategory.Developer,
    compatibleWithBusinessMode: recipe
      ? isRecipeCompatible(recipe, automation.businessModeKey)
      : true,
    readiness: automation.readiness ?? {},
    publishedVersionId: automation.publishedVersionId,
    updatedAt: automation.updatedAt.toISOString(),
  };
}

export function mapAutomationDetail(
  automation: LeadFlowAutomationEntity,
): LeadFlowAutomationDetailResponse {
  const recipe = getRecipeByKey(automation.recipeKey);
  const metadata = (automation.metadata ?? {}) as LeadFlowJsonObject;

  return {
    ...mapAutomationSummary(automation),
    contextType: automation.contextType,
    agencyClientId: automation.agencyClientId,
    settingsId: automation.settingsId,
    // Default deny; the service overrides with the caller's real capability.
    capabilities: { developer: false },
    whenLabel: recipe?.whenLabel ?? null,
    limitsLabel: recipe?.limitsLabel ?? null,
    triggerConfig: automation.triggerConfig ?? {},
    conditionConfig: automation.conditionConfig ?? {},
    actionConfig: automation.actionConfig ?? {},
    messageConfig: automation.messageConfig ?? {},
    crmPolicy: automation.crmPolicy ?? {},
    schedulePolicy: automation.schedulePolicy ?? {},
    developerConfig: (automation.developerConfig ?? {}) as LeadFlowJsonObject,
    webhook: maskWebhookConfig(automation.webhookConfig),
    safetyRules: recipe
      ? [...recipe.safetyRules]
      : readStringArray(metadata.safetyRules),
    metadata,
    createdAt: automation.createdAt.toISOString(),
  };
}
