import type { LeadFlowAgentChannelBindingEntity } from '../entities/leadflow-agent-channel-binding.entity';
import type { LeadFlowAgentEntity } from '../entities/leadflow-agent.entity';
import { LeadFlowAgentStatus } from '../enums/leadflow-agent-status.enum';
import { LeadFlowAgentType } from '../enums/leadflow-agent-type.enum';
import type {
  LeadFlowAgentAvatarConfig,
  LeadFlowAgentBehaviorConfig,
  LeadFlowAgentChannelPolicy,
  LeadFlowAgentCrmPolicy,
  LeadFlowAgentHandoffPolicy,
  LeadFlowAgentPromptConfig,
  LeadFlowAgentReadiness,
  LeadFlowJsonObject,
} from '../types/leadflow-agent.types';

export interface LeadFlowAgentChannelBindingResponse {
  id: string;
  channelKey: string;
  provider: string | null;
  externalRef: string | null;
  status: string;
  config: LeadFlowJsonObject;
}

export interface LeadFlowAgentSummaryResponse {
  id: string;
  name: string;
  description: string | null;
  type: LeadFlowAgentType;
  status: LeadFlowAgentStatus;
  presetKey: string | null;
  businessModeKey: string;
  isSystem: boolean;
  isCustom: boolean;
  isProtected: boolean;
  avatarConfig: LeadFlowAgentAvatarConfig;
  readiness: LeadFlowAgentReadiness;
  channels: LeadFlowAgentChannelBindingResponse[];
  publishedVersionId: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  updatedAt: string;
}

export interface LeadFlowAgentDetailResponse extends LeadFlowAgentSummaryResponse {
  contextType: string;
  agencyClientId: string | null;
  settingsId: string | null;
  behaviorConfig: LeadFlowAgentBehaviorConfig;
  promptConfig: LeadFlowAgentPromptConfig;
  handoffPolicy: LeadFlowAgentHandoffPolicy;
  crmPolicy: LeadFlowAgentCrmPolicy;
  channelPolicy: LeadFlowAgentChannelPolicy;
  metadata: LeadFlowJsonObject;
  createdAt: string;
}

export interface LeadFlowAgentListResponse {
  items: LeadFlowAgentSummaryResponse[];
  businessModeKey: string;
  isCustomBusinessMode: boolean;
  operationsChat: Record<string, unknown>;
}

export function mapChannelBinding(
  binding: LeadFlowAgentChannelBindingEntity,
): LeadFlowAgentChannelBindingResponse {
  return {
    id: binding.id,
    channelKey: binding.channelKey,
    provider: binding.provider,
    externalRef: binding.externalRef,
    status: binding.status,
    config: binding.config ?? {},
  };
}

export function mapAgentSummary(
  agent: LeadFlowAgentEntity,
  bindings: LeadFlowAgentChannelBindingEntity[],
): LeadFlowAgentSummaryResponse {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    type: agent.type,
    status: agent.status,
    presetKey: agent.presetKey,
    businessModeKey: agent.businessModeKey,
    isSystem: agent.isSystem,
    isCustom: agent.isCustom,
    isProtected: agent.isProtected,
    avatarConfig: agent.avatarConfig ?? {},
    readiness: agent.readiness ?? {},
    channels: bindings.map(mapChannelBinding),
    publishedVersionId: agent.publishedVersionId,
    archivedAt: agent.archivedAt ? agent.archivedAt.toISOString() : null,
    deletedAt: agent.deletedAt ? agent.deletedAt.toISOString() : null,
    updatedAt: agent.updatedAt.toISOString(),
  };
}

export function mapAgentDetail(
  agent: LeadFlowAgentEntity,
  bindings: LeadFlowAgentChannelBindingEntity[],
): LeadFlowAgentDetailResponse {
  return {
    ...mapAgentSummary(agent, bindings),
    contextType: agent.contextType,
    agencyClientId: agent.agencyClientId,
    settingsId: agent.settingsId,
    behaviorConfig: agent.behaviorConfig ?? {},
    promptConfig: agent.promptConfig ?? {},
    handoffPolicy: agent.handoffPolicy ?? {},
    crmPolicy: agent.crmPolicy ?? {},
    channelPolicy: agent.channelPolicy ?? {},
    metadata: agent.metadata ?? {},
    createdAt: agent.createdAt.toISOString(),
  };
}
