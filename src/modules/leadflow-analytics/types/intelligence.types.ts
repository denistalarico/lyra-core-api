import type {
  IntelligenceRecommendationEvidenceV1,
  IntelligenceRecommendationPolicySnapshot,
} from '../../../common/intelligence';

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

/**
 * The evidence this domain persists, which is the shared contract.
 *
 * An alias rather than a local interface: the previous five-field shape lived
 * here because there was nothing to share it with, and re-declaring it now —
 * even identically — would let the two drift the first time one of them gained a
 * field. The name is kept so every existing import site still resolves.
 *
 * The shared type is a strict superset of what this domain used to store, so the
 * API response shape below and its frontend mirror keep reading `ref`, `label`,
 * `metric`, `value` and `unit` unchanged.
 */
export type LeadFlowIntelligenceEvidence = IntelligenceRecommendationEvidenceV1;

/**
 * The rules that produced one recommendation, as that recommendation recorded
 * them.
 *
 * Read from the stored row, never from the policy currently in force. `key` and
 * `version` are null for rows generated before the platform recorded this —
 * unknown rather than assumed to be v1.
 */
export interface LeadFlowIntelligenceRecommendationPolicyRef {
  key: string | null;
  version: number | null;
  parameters: IntelligenceRecommendationPolicySnapshot;
}

export interface LeadFlowIntelligenceRecommendationResponse {
  id: string;
  kind: LeadFlowIntelligenceRecommendationKind;
  /**
   * The thresholds this recommendation was actually generated under.
   *
   * Distinct from the envelope's `policy`, which describes what the rules say
   * *today*. The two agree until the policy changes, and the whole point of
   * this field is the moment they stop agreeing.
   */
  policy: LeadFlowIntelligenceRecommendationPolicyRef;
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
  /**
   * The policy in force **now** — what a newly generated recommendation would
   * be judged against.
   *
   * Kept at its shipped shape and field names because a deployed client mirrors
   * it. It is emphatically not the policy behind any particular item in
   * `items`: for that, read `item.policy`. Serialising a historical row against
   * these numbers was the defect R2.1 exists to close.
   */
  policy: {
    key: 'automation_failure_pause_v1';
    minimumTerminalLiveRuns: number;
    minimumFailedRuns: number;
    minimumFailureRate: number;
    appliesAutomatically: false;
  };
}
