export type InboxProviderUsage = {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  audioSeconds?: number;
  images?: number;
  estimatedCostUsd?: number;
};

export type AudioTranscriptionInput = {
  tenantId: string;
  workspaceId: string;
  assetId: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
  bytes: Buffer;
  expectedLanguage?: string;
  correlationId: string;
  idempotencyKey: string;
};

export type AudioTranscriptionResult = {
  outcome: 'content' | 'empty' | 'indeterminate';
  text: string;
  language: string | null;
  confidence: number | null;
  provider: string;
  model: string;
  processorVersion: string;
  usage: InboxProviderUsage;
  startedAt: Date;
  completedAt: Date;
  latencyMs: number;
  attempts?: number;
};

export interface AudioTranscriptionProvider {
  transcribe(input: AudioTranscriptionInput): Promise<AudioTranscriptionResult>;
}

export type VisionAnalysisInput = {
  tenantId: string;
  workspaceId: string;
  assetId: string;
  mimeType: string;
  checksum: string;
  bytes: Buffer;
  idempotencyKey: string;
};

export type VisionAnalysisResult = {
  text: string;
  provider: string;
  model: string;
  processorVersion: string;
  usage: InboxProviderUsage;
  latencyMs: number;
  attempts?: number;
};

export interface VisionAnalysisProvider {
  analyzeImage(input: VisionAnalysisInput): Promise<VisionAnalysisResult>;
}

export type AgentDecisionV1 = {
  schema_version: 1;
  reply: string | null;
  follow_text: string | null;
  stage_key: string | null;
  stage_name: string | null;
  tags: string[];
  handoff: boolean;
  handoff_reason: string | null;
  agent_summary: string;
  service: string | null;
  urgency: 'low' | 'normal' | 'high' | 'urgent';
  close_reason: string | null;
  confidence: number;
  evidence_refs: string[];
  proposed_actions: Array<{
    type: 'set_stage' | 'add_tag' | 'set_summary' | 'close' | 'handoff';
    value?: string | null;
  }>;
};

export type AgentDecisionInput = {
  tenantId: string;
  workspaceId: string;
  correlationId: string;
  idempotencyKey: string;
  agent: { id: string | null; versionId: string | null; snapshot: unknown };
  businessMode: string;
  workspaceConfig: Record<string, unknown>;
  contact: { id: string | null };
  opportunity: Record<string, unknown> | null;
  ownership: { state: string; version: number };
  allowedActions: string[];
  systemPolicy: string;
  untrustedData: string;
  promptVersion: string;
  promptHash: string;
  images: Array<{
    assetId: string;
    evidenceRef: string;
    mimeType: string;
    bytes: Buffer;
  }>;
  repairAttempt: boolean;
};

export type AgentDecisionResult = {
  decision: unknown;
  provider: string;
  model: string;
  usage: InboxProviderUsage;
  latencyMs: number;
  attempts?: number;
};

export interface AgentDecisionProvider {
  decide(input: AgentDecisionInput): Promise<AgentDecisionResult>;
  supportsMultimodal(): boolean;
}

export class InboxProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly attempts = 0,
    public readonly usage?: InboxProviderUsage,
  ) {
    super(code);
  }
}
