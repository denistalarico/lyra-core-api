import type { LeadFlowBusinessModeTemplateEntity } from '../entities';
import type { LeadFlowSettingsStatus } from '../enums/leadflow-settings-status.enum';
import type { LeadFlowJsonObject } from '../types/leadflow-settings.types';

export type LeadFlowBusinessModeTemplateSummaryResponse = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  version: number;
  status: LeadFlowSettingsStatus;
  isOfficial: boolean;
  isSystem: boolean;
  isDeveloperOnly: boolean;
  recommendedApps: LeadFlowJsonObject[];
  supportedIntegrations: LeadFlowJsonObject;
  metadata: LeadFlowJsonObject;
};

export type LeadFlowBusinessModeTemplateDetailResponse =
  LeadFlowBusinessModeTemplateSummaryResponse & {
    pipelineTemplate: LeadFlowJsonObject;
    conversionGoals: LeadFlowJsonObject;
    qualificationFields: LeadFlowJsonObject[];
    agentPromptTemplate: LeadFlowJsonObject;
    clientPromptSchema: LeadFlowJsonObject;
    inboxRules: LeadFlowJsonObject;
    handoffRules: LeadFlowJsonObject;
    developerOverridesSchema: LeadFlowJsonObject;
  };

export type LeadFlowBusinessModeTemplateListResponse = {
  items: LeadFlowBusinessModeTemplateSummaryResponse[];
};

export function mapBusinessModeTemplateSummary(
  template: LeadFlowBusinessModeTemplateEntity,
): LeadFlowBusinessModeTemplateSummaryResponse {
  return {
    id: template.id,
    key: template.key,
    name: template.name,
    description: template.description,
    category: template.category,
    version: template.version,
    status: template.status,
    isOfficial: template.isOfficial,
    isSystem: template.isSystem,
    isDeveloperOnly: template.isDeveloperOnly,
    recommendedApps: template.recommendedApps,
    supportedIntegrations: template.supportedIntegrations,
    metadata: template.metadata,
  };
}

export function mapBusinessModeTemplateDetail(
  template: LeadFlowBusinessModeTemplateEntity,
): LeadFlowBusinessModeTemplateDetailResponse {
  return {
    ...mapBusinessModeTemplateSummary(template),
    pipelineTemplate: template.pipelineTemplate,
    conversionGoals: template.conversionGoals,
    qualificationFields: template.qualificationFields,
    agentPromptTemplate: template.agentPromptTemplate,
    clientPromptSchema: template.clientPromptSchema,
    inboxRules: template.inboxRules,
    handoffRules: template.handoffRules,
    developerOverridesSchema: template.developerOverridesSchema,
  };
}
