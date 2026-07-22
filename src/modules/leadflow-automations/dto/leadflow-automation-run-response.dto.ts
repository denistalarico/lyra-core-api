import type { LeadFlowAutomationRunAttemptEntity } from '../entities/leadflow-automation-run-attempt.entity';
import type { LeadFlowAutomationRunEntity } from '../entities/leadflow-automation-run.entity';
import type { LeadFlowJsonObject } from '../types/leadflow-automation.types';

export interface LeadFlowAutomationAttemptResponse {
  id: string;
  attemptNumber: number;
  actionKey: string;
  status: string;
  errorClass: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  effectRequested: LeadFlowJsonObject;
  effectConfirmed: boolean;
  durationMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface LeadFlowAutomationRunResponse {
  id: string;
  automationId: string;
  recipeKey: string;
  templateVersion: number;
  /** `dry_run` or `live` — the field that keeps simulation out of "executions". */
  mode: string;
  status: string;
  skipReason: string | null;
  triggerType: string;
  triggerKind: string;
  sourceEventName: string | null;
  correlationId: string | null;
  inputSnapshot: LeadFlowJsonObject;
  result: LeadFlowJsonObject;
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface LeadFlowAutomationRunDetailResponse extends LeadFlowAutomationRunResponse {
  attempts: LeadFlowAutomationAttemptResponse[];
}

export interface LeadFlowAutomationRunListResponse {
  automationId: string;
  /** Count of runs that actually executed. Zero until an engine exists. */
  liveRunCount: number;
  dryRunCount: number;
  items: LeadFlowAutomationRunResponse[];
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function mapRun(
  run: LeadFlowAutomationRunEntity,
): LeadFlowAutomationRunResponse {
  return {
    id: run.id,
    automationId: run.automationId,
    recipeKey: run.recipeKey,
    templateVersion: run.templateVersion,
    mode: run.mode,
    status: run.status,
    skipReason: run.skipReason,
    triggerType: run.triggerType,
    triggerKind: run.triggerKind,
    sourceEventName: run.sourceEventName,
    correlationId: run.correlationId,
    inputSnapshot: run.inputSnapshot ?? {},
    result: run.result ?? {},
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    attemptCount: run.attemptCount,
    scheduledAt: iso(run.scheduledAt),
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
    createdAt: run.createdAt.toISOString(),
  };
}

export function mapAttempt(
  attempt: LeadFlowAutomationRunAttemptEntity,
): LeadFlowAutomationAttemptResponse {
  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    actionKey: attempt.actionKey,
    status: attempt.status,
    errorClass: attempt.errorClass,
    errorCode: attempt.errorCode,
    errorMessage: attempt.errorMessage,
    effectRequested: attempt.effectRequested ?? {},
    effectConfirmed: attempt.effectConfirmed,
    durationMs: attempt.durationMs,
    startedAt: iso(attempt.startedAt),
    finishedAt: iso(attempt.finishedAt),
  };
}

export function mapRunDetail(
  run: LeadFlowAutomationRunEntity,
  attempts: LeadFlowAutomationRunAttemptEntity[],
): LeadFlowAutomationRunDetailResponse {
  return { ...mapRun(run), attempts: attempts.map(mapAttempt) };
}
