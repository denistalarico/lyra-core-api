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
    /**
     * Company-context copy the mode ships with. Persisted inside `metadata`
     * (no dedicated column), but promoted here so consumers read a stable
     * field instead of reaching into the metadata bag.
     */
    contextDefaults: LeadFlowJsonObject;
  };

export type LeadFlowBusinessModeTemplateListResponse = {
  items: LeadFlowBusinessModeTemplateSummaryResponse[];
};

/** Older rows seeded before the catalog shipped defaults simply have none. */
export function readContextDefaults(
  metadata: LeadFlowJsonObject | null | undefined,
): LeadFlowJsonObject {
  const value = metadata?.contextDefaults;
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as LeadFlowJsonObject)
    : {};
}

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
    contextDefaults: readContextDefaults(template.metadata),
  };
}
