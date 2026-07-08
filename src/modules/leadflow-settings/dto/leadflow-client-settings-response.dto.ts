import type { LeadFlowClientSettingsEntity } from '../entities';
import type { LeadFlowSettingsStatus } from '../enums/leadflow-settings-status.enum';
import type {
  LeadFlowEnabledAppsConfig,
  LeadFlowEnabledIntegrationsConfig,
  LeadFlowJsonObject,
} from '../types/leadflow-settings.types';

export type LeadFlowClientSettingsResponse = {
  id: string;
  tenantId: string;
  workspaceId: string;
  agencyClientId: string;
  managedTenantId: string | null;
  businessModeKey: string;
  businessModeTemplateId: string | null;
  planKey: string | null;
  status: LeadFlowSettingsStatus;
  developerModeEnabled: boolean;
  enabledApps: LeadFlowEnabledAppsConfig;
  enabledIntegrations: LeadFlowEnabledIntegrationsConfig;
  permissionsConfig: LeadFlowJsonObject;
  brandingConfig: LeadFlowJsonObject;
  agentConfig: LeadFlowJsonObject;
  clientPromptConfig: LeadFlowJsonObject;
  inboxConfig: LeadFlowJsonObject;
  inboxOverrides: LeadFlowJsonObject;
  handoffOverrides: LeadFlowJsonObject;
  leadsConfig: LeadFlowJsonObject;
  pipelineRef: LeadFlowJsonObject;
  businessModeOverrides: LeadFlowJsonObject;
  metadata: LeadFlowJsonObject;
  createdById: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function mapLeadFlowClientSettingsResponse(
  entity: LeadFlowClientSettingsEntity,
): LeadFlowClientSettingsResponse {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    workspaceId: entity.workspaceId,
    agencyClientId: entity.agencyClientId,
    managedTenantId: entity.managedTenantId,
    businessModeKey: entity.businessModeKey,
    businessModeTemplateId: entity.businessModeTemplateId,
    planKey: entity.planKey,
    status: entity.status,
    developerModeEnabled: entity.developerModeEnabled,
    enabledApps: entity.enabledApps,
    enabledIntegrations: entity.enabledIntegrations,
    permissionsConfig: entity.permissionsConfig,
    brandingConfig: entity.brandingConfig,
    agentConfig: entity.agentConfig,
    clientPromptConfig: entity.clientPromptConfig,
    inboxConfig: entity.inboxConfig,
    inboxOverrides: entity.inboxOverrides,
    handoffOverrides: entity.handoffOverrides,
    leadsConfig: entity.leadsConfig,
    pipelineRef: entity.pipelineRef,
    businessModeOverrides: entity.businessModeOverrides,
    metadata: entity.metadata,
    createdById: entity.createdById,
    updatedById: entity.updatedById,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
