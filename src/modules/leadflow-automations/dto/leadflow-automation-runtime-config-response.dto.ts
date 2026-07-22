import type {
  LeadFlowAutomationRuntimeContract,
  LeadFlowAutomationsRuntimeContract,
} from '../types/leadflow-automation.types';

export type LeadFlowAutomationRuntimeConfigResponse =
  LeadFlowAutomationRuntimeContract;

export type LeadFlowAutomationsRuntimeConfigResponse =
  LeadFlowAutomationsRuntimeContract;

/** A log line derived from a real run record. */
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
  /** False now that entries come from persisted runs rather than a stub. */
  placeholder: boolean;
  note: string;
  items: LeadFlowAutomationLogEntry[];
}

/** One condition evaluated during a dry-run. */
export interface LeadFlowAutomationDryRunCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

/**
 * Result of a dry-run: a real evaluation of the stored configuration against a
 * simulated situation, persisted as a run with `mode = dry_run`. Produces no
 * message, webhook, LLM call or cross-domain write.
 */
export interface LeadFlowAutomationDryRunResponse {
  automationId: string;
  /** The persisted run this simulation produced. */
  runId: string;
  wouldAct: boolean;
  status: string;
  skipReason: string | null;
  /**
   * True when the platform could not execute this automation even if every
   * condition passed. Reported separately so a green evaluation is never read
   * as "this is running".
   */
  blockedByDependency: boolean;
  note: string;
  simulatedTrigger: string;
  plannedActions: string[];
  checks: LeadFlowAutomationDryRunCheck[];
  context: Record<string, unknown>;
  readiness: LeadFlowAutomationRuntimeContract['readiness'];
  generatedAt: string;
}
