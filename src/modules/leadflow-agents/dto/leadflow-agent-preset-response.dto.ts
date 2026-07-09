import type { LeadFlowAgentPresetCatalogItem } from '../catalog/agent-presets.catalog';
import { LeadFlowAgentType } from '../enums/leadflow-agent-type.enum';

export interface LeadFlowAgentPresetResponse {
  key: string;
  businessModeKey: string;
  type: LeadFlowAgentType;
  name: string;
  description: string;
  isSystem: boolean;
  isProtected: boolean;
  isDeveloperOnly: boolean;
  allowedActions: string[];
  safetyRules: string[];
}

export interface LeadFlowAgentPresetListResponse {
  businessModeKey: string;
  isCustomBusinessMode: boolean;
  items: LeadFlowAgentPresetResponse[];
}

export function mapAgentPreset(
  preset: LeadFlowAgentPresetCatalogItem,
): LeadFlowAgentPresetResponse {
  return {
    key: preset.key,
    businessModeKey: preset.businessModeKey,
    type: preset.type,
    name: preset.name,
    description: preset.description,
    isSystem: preset.isSystem,
    isProtected: preset.isProtected,
    isDeveloperOnly: preset.isDeveloperOnly,
    allowedActions: [...preset.allowedActions],
    safetyRules: [...preset.safetyRules],
  };
}
