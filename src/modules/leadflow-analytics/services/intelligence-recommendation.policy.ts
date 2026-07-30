import type {
  LeadFlowIntelligenceEvidence,
  LeadFlowIntelligenceJson,
} from '../types/intelligence.types';

export const AUTOMATION_FAILURE_POLICY = {
  key: 'automation_failure_pause_v1' as const,
  minimumTerminalLiveRuns: 5,
  minimumFailedRuns: 2,
  minimumFailureRate: 0.3,
  appliesAutomatically: false as const,
};

export interface AutomationFailureSample {
  automationId: string;
  automationName: string;
  recipeKey: string;
  businessModeKey: string;
  succeededRuns: number;
  failedRuns: number;
}

export interface AutomationFailureRecommendationCandidate {
  confidence: number;
  evidence: LeadFlowIntelligenceEvidence[];
  baseline: LeadFlowIntelligenceJson;
  segment: LeadFlowIntelligenceJson;
}

export function buildAutomationFailureRecommendationCandidate(
  sample: AutomationFailureSample,
): AutomationFailureRecommendationCandidate | null {
  const terminalLiveRuns = sample.succeededRuns + sample.failedRuns;
  const failureRate =
    terminalLiveRuns === 0 ? 0 : sample.failedRuns / terminalLiveRuns;

  if (
    terminalLiveRuns < AUTOMATION_FAILURE_POLICY.minimumTerminalLiveRuns ||
    sample.failedRuns < AUTOMATION_FAILURE_POLICY.minimumFailedRuns ||
    failureRate < AUTOMATION_FAILURE_POLICY.minimumFailureRate
  ) {
    return null;
  }

  const confidence = round(
    Math.min(
      0.95,
      0.65 +
        Math.min(0.2, (terminalLiveRuns - 5) * 0.02) +
        Math.min(0.1, failureRate * 0.1),
    ),
  );

  return {
    confidence,
    evidence: [
      {
        ref: `leadflow_automation_runs:${sample.automationId}:terminal_live`,
        label: 'Execuções live concluídas ou falhas',
        metric: 'terminalLiveRuns',
        value: terminalLiveRuns,
        unit: 'runs',
      },
      {
        ref: `leadflow_automation_runs:${sample.automationId}:failed`,
        label: 'Execuções live com falha',
        metric: 'failedRuns',
        value: sample.failedRuns,
        unit: 'runs',
      },
      {
        ref: `leadflow_automation_runs:${sample.automationId}:failure_rate`,
        label: 'Taxa de falha entre desfechos live',
        metric: 'failureRate',
        value: round(failureRate),
        unit: 'ratio',
      },
    ],
    baseline: {
      terminalLiveRuns,
      succeededRuns: sample.succeededRuns,
      failedRuns: sample.failedRuns,
      failureRate: round(failureRate),
    },
    segment: {
      automationId: sample.automationId,
      automationName: sample.automationName,
      recipeKey: sample.recipeKey,
      businessMode: sample.businessModeKey,
    },
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
