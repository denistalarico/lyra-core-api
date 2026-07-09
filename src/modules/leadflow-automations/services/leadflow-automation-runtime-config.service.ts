import { Injectable } from '@nestjs/common';
import type { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import {
  getRecipeByKey,
  isCustomBusinessMode,
} from '../catalog/automation-recipes.catalog';
import { maskWebhookConfig } from '../dto/leadflow-automation-response.dto';
import type {
  LeadFlowAutomationRuntimeConfigResponse,
  LeadFlowAutomationsRuntimeConfigResponse,
} from '../dto/leadflow-automation-runtime-config-response.dto';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import type {
  LeadFlowAutomationRuntimeContract,
  LeadFlowAutomationStructuralRules,
  LeadFlowJsonObject,
} from '../types/leadflow-automation.types';

export const LEADFLOW_AUTOMATION_RUNTIME_CONTRACT_VERSION = 1;

const STRUCTURAL_RULES: LeadFlowAutomationStructuralRules = {
  everyConversationCreatesOpportunity: true,
  description:
    'Toda conversa recebida no Inbox gera ou vincula uma oportunidade no CRM/Leads. Regra estrutural do LeadFlow — não é uma automação configurável.',
};

/**
 * Builds the clean runtime contract consumed by a future runtime. This service
 * is pure: it never executes AI, dispatches messages, calls webhooks, or
 * touches Redis/queues. It only projects persisted config into a predictable
 * JSON envelope — and always masks secrets on the way out.
 */
@Injectable()
export class LeadFlowAutomationRuntimeConfigService {
  buildAutomationContract(
    automation: LeadFlowAutomationEntity,
    settings: LeadFlowClientSettingsEntity | null,
  ): LeadFlowAutomationRuntimeConfigResponse {
    const recipe = getRecipeByKey(automation.recipeKey);

    return {
      version: LEADFLOW_AUTOMATION_RUNTIME_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      tenantId: automation.tenantId,
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      recipeKey: automation.recipeKey,
      name: automation.name,
      category: automation.category,
      status: automation.status,
      businessMode: {
        key: automation.businessModeKey,
        isCustom: isCustomBusinessMode(automation.businessModeKey),
      },
      leadflowSettingsSnapshot: this.buildSettingsSnapshot(automation, settings),
      trigger: automation.triggerConfig ?? {},
      conditions: automation.conditionConfig ?? {},
      actions: automation.actionConfig ?? {},
      message: automation.messageConfig ?? {},
      crmPolicy: automation.crmPolicy ?? {},
      schedulePolicy: automation.schedulePolicy ?? {},
      developerConfig: this.buildDeveloperConfig(automation),
      webhook: maskWebhookConfig(automation.webhookConfig),
      safetyRules: recipe ? [...recipe.safetyRules] : [],
      readiness: automation.readiness ?? {},
      publishedVersionId: automation.publishedVersionId,
    };
  }

  buildContextContract(
    tenantId: string,
    workspaceId: string,
    settings: LeadFlowClientSettingsEntity | null,
    businessModeKey: string,
    automationContracts: LeadFlowAutomationRuntimeContract[],
  ): LeadFlowAutomationsRuntimeConfigResponse {
    return {
      version: LEADFLOW_AUTOMATION_RUNTIME_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      tenantId,
      workspaceId,
      businessMode: {
        key: businessModeKey,
        isCustom: isCustomBusinessMode(businessModeKey),
      },
      leadflowSettingsSnapshot: this.buildSettingsSnapshotFromSettings(settings),
      structuralRules: STRUCTURAL_RULES,
      enabledAutomations: automationContracts,
    };
  }

  /** Developer flags only — never any secret material. */
  private buildDeveloperConfig(
    automation: LeadFlowAutomationEntity,
  ): LeadFlowJsonObject {
    const developer = (automation.developerConfig ?? {}) as LeadFlowJsonObject;
    return {
      enabled: developer.enabled === true,
      dryRunEnabled: developer.dryRunEnabled === true,
      advancedConditions:
        developer.advancedConditions &&
        typeof developer.advancedConditions === 'object'
          ? developer.advancedConditions
          : {},
    };
  }

  private buildSettingsSnapshot(
    automation: LeadFlowAutomationEntity,
    settings: LeadFlowClientSettingsEntity | null,
  ): LeadFlowAutomationRuntimeContract['leadflowSettingsSnapshot'] {
    if (!settings) {
      return {
        settingsId: automation.settingsId,
        contextType: automation.contextType,
        status: 'unknown',
        planKey: null,
        developerModeEnabled: false,
      };
    }

    return this.buildSettingsSnapshotFromSettings(settings);
  }

  private buildSettingsSnapshotFromSettings(
    settings: LeadFlowClientSettingsEntity | null,
  ): LeadFlowAutomationRuntimeContract['leadflowSettingsSnapshot'] {
    return {
      settingsId: settings?.id ?? null,
      contextType: settings?.contextType ?? 'agency',
      status: settings?.status ?? 'unknown',
      planKey: settings?.planKey ?? null,
      developerModeEnabled: settings?.developerModeEnabled ?? false,
    };
  }
}
