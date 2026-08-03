/**
 * Extraction job lifecycle. Legal transitions (enforced by
 * LeadFlowBriefingJobStateMachine, not by the DB):
 *   queued -> processing -> succeeded            (terminal)
 *   queued -> processing -> failed -> queued      (retry while attempts < maxAttempts)
 *                          -> failed -> dead_letter (attempts >= maxAttempts)
 *   queued | processing -> cancelled              (terminal)
 */
export enum LeadFlowBriefingJobStatus {
  Queued = 'queued',
  Processing = 'processing',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Cancelled = 'cancelled',
  DeadLetter = 'dead_letter',
}

export const LEADFLOW_BRIEFING_JOB_TERMINAL_STATUSES: LeadFlowBriefingJobStatus[] =
  [
    LeadFlowBriefingJobStatus.Succeeded,
    LeadFlowBriefingJobStatus.Cancelled,
    LeadFlowBriefingJobStatus.DeadLetter,
  ];
