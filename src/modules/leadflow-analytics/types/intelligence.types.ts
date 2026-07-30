export const LEADFLOW_INTELLIGENCE_RECOMMENDATION_STATUSES = [
  'pending',
  'snoozed',
  'applied',
  'rejected',
  'rolled_back',
] as const;

export type LeadFlowIntelligenceRecommendationStatus =
  (typeof LEADFLOW_INTELLIGENCE_RECOMMENDATION_STATUSES)[number];

export const LEADFLOW_INTELLIGENCE_DECISION_ACTIONS = [
  'approve',
  'reject',
  'snooze',
  'rollback',
] as const;

export type LeadFlowIntelligenceDecisionAction =
  (typeof LEADFLOW_INTELLIGENCE_DECISION_ACTIONS)[number];

export type LeadFlowIntelligenceTargetType = 'automation';
export type LeadFlowIntelligenceRecommendationKind =
  'pause_automation_high_failure_rate';
export type LeadFlowIntelligenceJson = Record<string, unknown>;

export interface LeadFlowIntelligenceEvidence {
  ref: string;
  label: string;
  metric: string;
  value: number | string;
  unit: string;
}

export interface LeadFlowIntelligenceRecommendationResponse {
  id: string;
  kind: LeadFlowIntelligenceRecommendationKind;
  status: LeadFlowIntelligenceRecommendationStatus;
  title: string;
  rationale: string;
  target: {
    type: LeadFlowIntelligenceTargetType;
    id: string;
    label: string;
  };
  period: { from: string; to: string };
  segment: LeadFlowIntelligenceJson;
  evidence: LeadFlowIntelligenceEvidence[];
  confidence: number;
  expectedImpact: LeadFlowIntelligenceJson;
  currentConfig: LeadFlowIntelligenceJson;
  proposedConfig: LeadFlowIntelligenceJson;
  baseline: LeadFlowIntelligenceJson;
  generatedAt: string;
  snoozedUntil: string | null;
  appliedAt: string | null;
  measurementDueAt: string | null;
  rolledBackAt: string | null;
  decisions: Array<{
    id: string;
    action: LeadFlowIntelligenceDecisionAction;
    reason: string | null;
    snoozedUntil: string | null;
    actorUserId: string | null;
    createdAt: string;
  }>;
  versions: Array<{
    id: string;
    version: number;
    status: string;
    previousConfig: LeadFlowIntelligenceJson;
    config: LeadFlowIntelligenceJson;
    rollbackOfVersionId: string | null;
    appliedAt: string;
    rolledBackAt: string | null;
  }>;
  latestResult: {
    id: string;
    status: string;
    period: { from: string; to: string };
    baseline: LeadFlowIntelligenceJson;
    observed: LeadFlowIntelligenceJson;
    delta: LeadFlowIntelligenceJson;
    conclusion: string;
    measuredAt: string;
  } | null;
}

export interface LeadFlowIntelligenceRecommendationsResponse {
  items: LeadFlowIntelligenceRecommendationResponse[];
  generatedCount?: number;
  policy: {
    key: 'automation_failure_pause_v1';
    minimumTerminalLiveRuns: number;
    minimumFailedRuns: number;
    minimumFailureRate: number;
    appliesAutomatically: false;
  };
}
