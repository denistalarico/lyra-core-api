// src/modules/platform-settings/dto/business-mode-summary.view.ts
//
// Sanitized read contract for `/platform/business-modes`. The template
// entity carries LeadFlow-only payloads (pipelineTemplate, agentPromptTemplate,
// clientPromptSchema, inboxRules, handoffRules, developerOverridesSchema) —
// see social-settings-architecture.md §6. This view exposes only the fields
// documented there as neutral.

import type { LeadFlowBusinessModeTemplateEntity } from '../../leadflow-settings/entities';

export interface BusinessModeSummaryResponse {
  key: string;
  name: string;
  description: string | null;
  category: string | null;
}

export function mapBusinessModeSummaryResponse(
  template: LeadFlowBusinessModeTemplateEntity,
): BusinessModeSummaryResponse {
  return {
    key: template.key,
    name: template.name,
    description: template.description,
    category: template.category,
  };
}
