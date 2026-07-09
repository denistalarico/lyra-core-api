import type { LeadFlowAgentRuntimeContract } from '../types/leadflow-agent.types';

export type LeadFlowAgentRuntimeConfigResponse = LeadFlowAgentRuntimeContract;

/**
 * Context-level runtime config: the shared settings/business-mode envelope plus
 * the runtime contract of every active agent in the current context. Pure data,
 * no AI executed.
 */
export interface LeadFlowAgentsRuntimeConfigResponse {
  version: number;
  generatedAt: string;
  tenantId: string;
  workspaceId: string;
  leadflowSettingsSnapshot: LeadFlowAgentRuntimeContract['leadflowSettingsSnapshot'];
  businessMode: LeadFlowAgentRuntimeContract['businessMode'];
  clientPromptConfigSnapshot: LeadFlowAgentRuntimeContract['clientPromptConfigSnapshot'];
  agents: LeadFlowAgentRuntimeContract[];
}
