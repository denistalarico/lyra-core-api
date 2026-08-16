import type { LeadFlowAutomationConfigSchema } from '../catalog/automation-config-schemas.catalog';
import {
  getRecipeByKey,
  isRecipeCompatible,
  type LeadFlowAutomationTriggerKind,
} from '../catalog/automation-recipes.catalog';
import type { LeadFlowAutomationLifecycle } from '../services/leadflow-automation-lifecycle.service';
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

  const events = Array.isArray(config.events)
    ? config.events.filter(
        (event): event is string =>
          typeof event === 'string' && event.length > 0,
      )
    : [];

  const hasContent =
    config.enabled === true ||
    Boolean(config.direction) ||
    Boolean(config.url) ||
    Boolean(config.secret) ||
    events.length > 0 ||
    (config.headers && Object.keys(config.headers).length > 0);

  if (!hasContent) {
    return null;
  }

  const secret = typeof config.secret === 'string' ? config.secret : null;
  const secretMasked =
    secret && secret.length > 0 ? `••••${secret.slice(-4)}` : null;

  const retry = config.retryPolicy ?? {};

  return {
    enabled: config.enabled === true,
    direction: config.direction ?? null,
    url: config.url ?? null,
    method: config.method ?? null,
    headers: (config.headers as LeadFlowJsonObject) ?? {},
    payloadMapping: (config.payloadMapping as LeadFlowJsonObject) ?? {},
    events,
    payloadFields: (config.payloadFields as LeadFlowJsonObject) ?? {},
    expectJsonResponse: config.expectJsonResponse === true,
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
  triggerKind: LeadFlowAutomationTriggerKind | null;
  primaryAction: string;
  isDeveloperRecipe: boolean;
  compatibleWithBusinessMode: boolean;
  /** Template version the instance was provisioned from. */
  templateVersion: number;
  /** True when the catalog has moved past the instance's template version. */
  templateOutdated: boolean;
  readiness: LeadFlowAutomationReadiness;
  publishedVersionId: string | null;
  updatedAt: string;
  /**
   * Masked webhook configuration, for the recipes that have one.
   *
   * Present on the summary because webhooks are listed as endpoints: the list
   * has to show the URL and how many events each carries, which are the two
   * things that tell one endpoint from another. The secret is masked here by
   * the same function the detail uses.
   */
  webhook?: LeadFlowAutomationWebhookPublic | null;
  /**
   * Effective state. Attached by the service, which owns the business-mode and
   * dependency context the mappers do not have.
   */
  lifecycle?: LeadFlowAutomationLifecycle;
}

export interface LeadFlowAutomationCapabilities {
  /** Whether the caller may edit developer/webhook config and run dry-runs. */
  developer: boolean;
}

export interface LeadFlowNotificationChannelCapability {
  available: boolean;
  reason: string | null;
}

export type LeadFlowNotificationChannelCapabilities = Record<
  'in_app' | 'push' | 'platform_whatsapp' | 'email' | 'sms',
  LeadFlowNotificationChannelCapability
>;

export interface LeadFlowAutomationDetailResponse extends LeadFlowAutomationSummaryResponse {
  contextType: string;
  agencyClientId: string | null;
  settingsId: string | null;
  capabilities: LeadFlowAutomationCapabilities;
  /** Runtime-backed availability for the hot-lead channel selector. */
  notificationChannelCapabilities?: LeadFlowNotificationChannelCapabilities;
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
  /**
   * Closed schema of the fields this automation accepts, including which
   * surface (essential/advanced/developer) each belongs to. Null when the
   * recipe no longer exists in the catalog.
   */
  configSchema?: LeadFlowAutomationConfigSchema | null;
}

export interface LeadFlowAutomationListResponse {
  items: LeadFlowAutomationSummaryResponse[];
  businessModeKey: string;
  isCustomBusinessMode: boolean;
  /** False while the platform has no execution engine at all. */
  runtimeAvailable: boolean;
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
  const templateVersion = automation.templateVersion ?? 1;

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
    triggerKind: recipe?.triggerKind ?? null,
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
    templateVersion,
    // Surfaced, never auto-applied: upgrading a published configuration is an
    // explicit operator decision, not a side effect of the catalog moving on.
    templateOutdated: recipe ? recipe.templateVersion > templateVersion : false,
    readiness: automation.readiness ?? {},
    publishedVersionId: automation.publishedVersionId,
    updatedAt: automation.updatedAt.toISOString(),
    webhook: maskWebhookConfig(automation.webhookConfig),
  };
}

export function mapAutomationDetail(
  automation: LeadFlowAutomationEntity,
): LeadFlowAutomationDetailResponse {
  const recipe = getRecipeByKey(automation.recipeKey);
  const metadata = automation.metadata ?? {};

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
