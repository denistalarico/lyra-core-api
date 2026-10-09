export type MeetingAiContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
  role?: string | null;
};
export type MeetingAiStage =
  | 'starting'
  | 'capturing'
  | 'finalizing'
  | 'transcribing'
  | 'summarizing'
  | 'exporting'
  | 'ready'
  | 'failed';
export type MeetingAiConfig = {
  enabled: boolean;
  expenseAccountId: string | null;
  costCenterId: string | null;
  maxCostUsd: number;
  maxCaptureMinutes: number;
  retentionDays: number;
};
export const DEFAULT_MEETING_AI_CONFIG: MeetingAiConfig = {
  enabled: false,
  expenseAccountId: null,
  costCenterId: null,
  maxCostUsd: 2,
  maxCaptureMinutes: 90,
  retentionDays: 30,
};
export type MeetingAiEvidence = { text: string; evidence: string };
export type MeetingAiAction = MeetingAiEvidence & {
  owner: string | null;
  dueDate: string | null;
};
export type MeetingAiResult = {
  summary: string;
  topics: string[];
  agreements: MeetingAiEvidence[];
  decisions: MeetingAiEvidence[];
  nextSteps: string[];
  actionItems: MeetingAiAction[];
  openQuestions: string[];
};
export type MeetingAiCall = {
  key: string;
  kind: 'transcription' | 'summary';
  state: 'dispatched' | 'completed' | 'unknown';
  reservedUsd: number;
  costUsd: number | null;
  inputTokens: number | null;
  cachedTokens: number | null;
  outputTokens: number | null;
  requestId: string | null;
  model: string;
  dispatchedAt: string;
  resultRef?: string;
};
/** Private worker state. Never serialize this object in an HTTP response. */
export type MeetingAiExecution = {
  version: 1;
  stage: MeetingAiStage;
  config: MeetingAiConfig;
  accountName: string;
  costCenterName: string;
  captureRequestedAt: string;
  captureStartedAt?: string;
  captureEndedAt?: string;
  partial: boolean;
  captureStopPending?: boolean;
  egressId?: string;
  audioRef: string;
  audioSeconds?: number;
  audioChecksum?: string;
  pdfRef?: string;
  layoutSnapshotRef?: string;
  transcriptRef?: string;
  calls: MeetingAiCall[];
  retries: number;
  participants?: string[];
  audioExpiredAt?: string;
  rates: {
    date: string;
    transcriptionInput: number;
    transcriptionOutput: number;
    summaryInput: number;
    summaryCached: number;
    summaryOutput: number;
  };
};
export function meetingAiCost(calls: MeetingAiCall[]): number | null {
  if (calls.some((call) => call.costUsd === null)) return null;
  return Number(
    calls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0).toFixed(8),
  );
}
export function projectMeetingAi(row: {
  id: string;
  status: string;
  errorMessage: string | null;
  completedAt: Date | null;
  execution: MeetingAiExecution | null;
}) {
  const execution = row.execution;
  if (!execution) return null;
  return {
    id: row.id,
    status: row.status,
    stage: execution.stage,
    partial: execution.partial,
    captureStartedAt: execution.captureStartedAt ?? null,
    pdfAvailable: Boolean(execution.pdfRef),
    completedAt: row.completedAt,
    errorMessage: row.errorMessage,
    costUsd: meetingAiCost(execution.calls),
    inputTokens: execution.calls.reduce(
      (sum, call) => sum + (call.inputTokens ?? 0),
      0,
    ),
    outputTokens: execution.calls.reduce(
      (sum, call) => sum + (call.outputTokens ?? 0),
      0,
    ),
    expenseAccountId: execution.config.expenseAccountId,
    expenseAccountName: execution.accountName,
    costCenterId: execution.config.costCenterId,
    costCenterName: execution.costCenterName,
    currency: 'USD',
    costBasis: 'provider_usage_estimate',
  };
}
