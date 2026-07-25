import { Injectable } from '@nestjs/common';
import type { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { isCustomBusinessMode } from '../catalog/agent-presets.catalog';
import { resolveAgentRolePolicy } from '../catalog/agent-role-policy.catalog';
import { computeAgentReadiness } from './agent-readiness';
import type { LeadFlowAgentChannelBindingEntity } from '../entities/leadflow-agent-channel-binding.entity';
import type { LeadFlowAgentEntity } from '../entities/leadflow-agent.entity';
import type {
  LeadFlowAgentsRuntimeConfigResponse,
  LeadFlowAgentRuntimeConfigResponse,
} from '../dto/leadflow-agent-runtime-config-response.dto';
import type {
  LeadFlowAgentRuntimeContract,
  LeadFlowJsonObject,
} from '../types/leadflow-agent.types';

export const LEADFLOW_AGENT_RUNTIME_CONTRACT_VERSION = 1;

/**
 * Builds the clean runtime contract consumed by a future runtime. This service
 * is pure: it never executes AI, renders prompts, or touches Redis/queues. It
 * only projects persisted config into a predictable JSON envelope.
 */
@Injectable()
export class LeadFlowAgentRuntimeConfigService {
  buildAgentContract(
    agent: LeadFlowAgentEntity,
    settings: LeadFlowClientSettingsEntity | null,
    bindings: LeadFlowAgentChannelBindingEntity[],
  ): LeadFlowAgentRuntimeConfigResponse {
    const metadata = agent.metadata ?? {};
    const rolePolicy = resolveAgentRolePolicy(agent.type);

    return {
      version: LEADFLOW_AGENT_RUNTIME_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      tenantId: agent.tenantId,
      workspaceId: agent.workspaceId,
      leadflowSettingsSnapshot: this.buildSettingsSnapshot(agent, settings),
      businessMode: {
        key: agent.businessModeKey,
        isCustom: isCustomBusinessMode(agent.businessModeKey),
      },
      clientPromptConfigSnapshot: this.buildClientPromptSnapshot(settings),
      agentIdentity: {
        agentId: agent.id,
        name: agent.name,
        type: agent.type,
        presetKey: agent.presetKey,
        status: agent.status,
        isSystem: agent.isSystem,
        isCustom: agent.isCustom,
        avatar: agent.avatarConfig ?? {},
        roleTitle:
          typeof agent.behaviorConfig?.roleTitle === 'string'
            ? agent.behaviorConfig.roleTitle
            : rolePolicy.roleTitle,
        primaryLanguage:
          typeof agent.behaviorConfig?.language === 'string'
            ? agent.behaviorConfig.language
            : 'pt-BR',
        allowedLanguages: Array.isArray(agent.behaviorConfig?.allowedLanguages)
          ? agent.behaviorConfig.allowedLanguages.filter(
              (item): item is string => typeof item === 'string',
            )
          : ['pt-BR'],
        introductionPolicy:
          typeof agent.behaviorConfig?.introductionPolicy === 'string'
            ? agent.behaviorConfig.introductionPolicy
            : 'when_asked',
        aiDisclosure:
          typeof agent.behaviorConfig?.aiDisclosure === 'string'
            ? agent.behaviorConfig.aiDisclosure
            : 'Sou um assistente virtual.',
      },
      behavior: agent.behaviorConfig ?? {},
      promptPolicy: agent.promptConfig ?? {},
      channelBindings: bindings.map((binding) => ({
        channelKey: binding.channelKey,
        provider: binding.provider,
        externalRef: binding.externalRef,
        status: binding.status,
        config: binding.config ?? {},
      })),
      crmPolicy: agent.crmPolicy ?? {},
      handoffPolicy: agent.handoffPolicy ?? {},
      allowedActions: this.readStringArray(metadata.allowedActions),
      role: {
        type: rolePolicy.type,
        roleTitle: rolePolicy.roleTitle,
        objective: rolePolicy.objective,
        allowedDecisionActions: [...rolePolicy.allowedDecisionActions],
        canProposeStageTransition: rolePolicy.canProposeStageTransition,
      },
      readiness: computeAgentReadiness(agent, settings, bindings),
      safetyRules: this.readStringArray(metadata.safetyRules),
      publishedVersionId: agent.publishedVersionId,
    };
  }

  buildContextContract(
    tenantId: string,
    workspaceId: string,
    settings: LeadFlowClientSettingsEntity | null,
    businessModeKey: string,
    agentContracts: LeadFlowAgentRuntimeContract[],
  ): LeadFlowAgentsRuntimeConfigResponse {
    return {
      version: LEADFLOW_AGENT_RUNTIME_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      tenantId,
      workspaceId,
      leadflowSettingsSnapshot:
        this.buildSettingsSnapshotFromSettings(settings),
      businessMode: {
        key: businessModeKey,
        isCustom: isCustomBusinessMode(businessModeKey),
      },
      clientPromptConfigSnapshot: this.buildClientPromptSnapshot(settings),
      agents: agentContracts,
    };
  }

  private buildSettingsSnapshot(
    agent: LeadFlowAgentEntity,
    settings: LeadFlowClientSettingsEntity | null,
  ): LeadFlowAgentRuntimeContract['leadflowSettingsSnapshot'] {
    if (!settings) {
      return {
        settingsId: agent.settingsId,
        contextType: agent.contextType,
        status: 'unknown',
        planKey: null,
        developerModeEnabled: false,
      };
    }

    return this.buildSettingsSnapshotFromSettings(settings);
  }

  private buildSettingsSnapshotFromSettings(
    settings: LeadFlowClientSettingsEntity | null,
  ): LeadFlowAgentRuntimeContract['leadflowSettingsSnapshot'] {
    return {
      settingsId: settings?.id ?? null,
      contextType: settings?.contextType ?? 'agency',
      status: settings?.status ?? 'unknown',
      planKey: settings?.planKey ?? null,
      developerModeEnabled: settings?.developerModeEnabled ?? false,
    };
  }

  private buildClientPromptSnapshot(
    settings: LeadFlowClientSettingsEntity | null,
  ): LeadFlowJsonObject {
    const value = settings?.companyContextPublished;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as LeadFlowJsonObject)
      : {};
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string');
  }
}
