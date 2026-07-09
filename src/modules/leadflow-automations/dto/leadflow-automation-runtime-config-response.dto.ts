import type {
  LeadFlowAutomationRuntimeContract,
  LeadFlowAutomationsRuntimeContract,
} from '../types/leadflow-automation.types';

export type LeadFlowAutomationRuntimeConfigResponse =
  LeadFlowAutomationRuntimeContract;

export type LeadFlowAutomationsRuntimeConfigResponse =
  LeadFlowAutomationsRuntimeContract;

/**
 * Safe placeholder log entry. No execution happens in this sprint, so logs are
 * always an empty, well-typed envelope — never real message/dispatch data.
 */
export interface LeadFlowAutomationLogEntry {
  id: string;
  automationId: string;
  level: 'info' | 'warn' | 'error';
  event: string;
  message: string;
  createdAt: string;
}

export interface LeadFlowAutomationLogsResponse {
  automationId: string;
  placeholder: true;
  note: string;
  items: LeadFlowAutomationLogEntry[];
}

/** Result of a dry-run: a static, predictable preview with no side effects. */
export interface LeadFlowAutomationDryRunResponse {
  automationId: string;
  placeholder: true;
  wouldTrigger: boolean;
  note: string;
  simulatedTrigger: string;
  simulatedActions: string[];
  readiness: LeadFlowAutomationRuntimeContract['readiness'];
  generatedAt: string;
}
