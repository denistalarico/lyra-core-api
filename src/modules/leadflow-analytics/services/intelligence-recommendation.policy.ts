import {
  INTELLIGENCE_RECOMMENDATION_EVIDENCE_SCHEMA_VERSION,
  toPolicyRef,
  type IntelligenceProvenance,
  type IntelligenceRecommendationPolicyDefinition,
  type IntelligenceRecommendationPolicyRef,
} from '../../../common/intelligence';
import type {
  LeadFlowIntelligenceEvidence,
  LeadFlowIntelligenceJson,
  LeadFlowIntelligenceRecommendationKind,
} from '../types/intelligence.types';

/**
 * How this recommendation knows what it knows.
 *
 * Stated conservatively, because the temptation in a provenance field is to
 * describe the strongest claim the data could support rather than the one it
 * does. This policy reads two tables the platform writes inside its own
 * transactions, in one product, for one workspace:
 *
 * - `ingestionMode: 'live'` — not a synced mirror of a provider. The rows were
 *   true at the instant they were read, so there is no sync lag to declare and
 *   no partial day to warn about.
 * - `attributionBasis: null` — and null here is a statement, not a gap. This
 *   domain has no attribution model at all; a value like `'account_default'`
 *   would import a paid-media concept into a count of job outcomes.
 *
 * The semantic kind that goes with it is `factual_observation` on every item:
 * nothing is correlated across domains, nothing is attributed to an ad, nothing
 * is compared against an anonymous cohort.
 */
const AUTOMATION_FAILURE_PROVENANCE: IntelligenceProvenance = {
  canonicalSource: 'leadflow_automation_runs',
  attributionBasis: null,
  ingestionMode: 'live',
  notes: {
    runMode: 'live',
    terminalStatuses: 'succeeded,failed',
  },
};

/**
 * The parameters this version of the rules applies.
 *
 * The values are unchanged from the pre-R2.1 constant. What changed is that
 * they now have an owner with an explicit version, and that the evaluator reads
 * them from here rather than from a bare constant whose edit history is the
 * only record of what it used to say.
 */
export interface AutomationFailurePolicyParameters extends Record<
  string,
  number | boolean
> {
  minimumTerminalLiveRuns: number;
  minimumFailedRuns: number;
  minimumFailureRate: number;
  appliesAutomatically: boolean;
}

/**
 * The policy in force, as the code declares it.
 *
 * Note the split between `key` and `generationKeyPrefix`. The identity is
 * `automation_failure_pause` — no version suffix, so `WHERE policy_key = ...`
 * finds every recommendation these rules ever made, across versions. The
 * generation key keeps the old suffixed literal because that string is baked
 * into stored `generation_key` values and is compared against them to decide
 * whether a recommendation already exists; rebuilding it differently would make
 * historical keys unmatchable and regenerate recommendations that were already
 * decided on.
 *
 * When the rules next change, this becomes `version: 2` with new parameters and
 * v1 is not edited. Recommendations generated under v1 keep reporting v1's
 * thresholds, because they carry their own copy.
 */
export const AUTOMATION_FAILURE_POLICY_DEFINITION: IntelligenceRecommendationPolicyDefinition<
  LeadFlowIntelligenceRecommendationKind,
  AutomationFailurePolicyParameters
> = {
  key: 'automation_failure_pause',
  version: 1,
  recommendationKind: 'pause_automation_high_failure_rate',
  generationKeyPrefix: 'automation_failure_pause_v1',
  parameters: {
    minimumTerminalLiveRuns: 5,
    minimumFailedRuns: 2,
    minimumFailureRate: 0.3,
    appliesAutomatically: false,
  },
};

/**
 * The published policy envelope, kept at its exact shipped shape.
 *
 * This is what the API returns as the *current* policy and what the frontend
 * type mirrors, so its field names and its `key` literal are a contract with a
 * deployed client rather than an internal detail. It is now derived from the
 * definition instead of being a second, independently editable copy of the same
 * numbers — which is what would otherwise let the published thresholds drift
 * away from the ones actually applied.
 *
 * `key` still carries the suffixed form: changing it would change a response
 * field a shipped client reads.
 */
export const AUTOMATION_FAILURE_POLICY = {
  key: 'automation_failure_pause_v1' as const,
  minimumTerminalLiveRuns:
    AUTOMATION_FAILURE_POLICY_DEFINITION.parameters.minimumTerminalLiveRuns,
  minimumFailedRuns:
    AUTOMATION_FAILURE_POLICY_DEFINITION.parameters.minimumFailedRuns,
  minimumFailureRate:
    AUTOMATION_FAILURE_POLICY_DEFINITION.parameters.minimumFailureRate,
  appliesAutomatically: false as const,
};

/**
 * The policy that governs this recommendation kind today.
 *
 * A function rather than a direct export because resolution is the seam a later
 * slice needs: a context-specific threshold (agency default 30%, one client
 * 40%) arrives as a lookup here, and every caller already goes through it. It
 * takes no arguments yet — inventing a scope parameter that nothing reads would
 * be a worse kind of speculation than the one it avoids.
 */
export function resolveAutomationFailurePolicy(): IntelligenceRecommendationPolicyDefinition<
  LeadFlowIntelligenceRecommendationKind,
  AutomationFailurePolicyParameters
> {
  return AUTOMATION_FAILURE_POLICY_DEFINITION;
}

export interface AutomationFailureSample {
  automationId: string;
  automationName: string;
  recipeKey: string;
  businessModeKey: string;
  succeededRuns: number;
  failedRuns: number;
  /**
   * The period the counts were taken over, when the caller knows it.
   *
   * Optional so that selection can still be exercised — by a spec or a future
   * caller — without inventing a window. When it is absent the evidence simply
   * omits `window` rather than defaulting to one, because a fabricated period on
   * a persisted explanation is worse than a missing one.
   */
  window?: { from: string; to: string };
}

export interface AutomationFailureRecommendationCandidate {
  confidence: number;
  evidence: LeadFlowIntelligenceEvidence[];
  baseline: LeadFlowIntelligenceJson;
  segment: LeadFlowIntelligenceJson;
  /**
   * The rules that produced this candidate, stamped at the moment they ran.
   *
   * Returned by the evaluator rather than looked up by the caller, so the
   * recorded thresholds are necessarily the ones the comparison above used. A
   * caller that resolved the policy independently could stamp one version while
   * a differently-resolved one did the selecting.
   */
  policy: IntelligenceRecommendationPolicyRef;
}

export function buildAutomationFailureRecommendationCandidate(
  sample: AutomationFailureSample,
): AutomationFailureRecommendationCandidate | null {
  const policy = resolveAutomationFailurePolicy();
  const parameters = policy.parameters;
  const terminalLiveRuns = sample.succeededRuns + sample.failedRuns;
  const failureRate =
    terminalLiveRuns === 0 ? 0 : sample.failedRuns / terminalLiveRuns;

  if (
    terminalLiveRuns < parameters.minimumTerminalLiveRuns ||
    sample.failedRuns < parameters.minimumFailedRuns ||
    failureRate < parameters.minimumFailureRate
  ) {
    return null;
  }

  // Left exactly as it was, including the literal `5` that happens to equal
  // `minimumTerminalLiveRuns`. Substituting the parameter would look like a
  // tidy-up and would in fact change confidence for every recommendation the
  // moment that threshold moves — a behaviour change smuggled in under a
  // refactor, in the one number a human reads as certainty. The coupling is
  // recorded here; whether confidence should be a policy parameter is a
  // question for the slice that revisits its semantics.
  const confidence = round(
    Math.min(
      0.95,
      0.65 +
        Math.min(0.2, (terminalLiveRuns - 5) * 0.02) +
        Math.min(0.1, failureRate * 0.1),
    ),
  );

  // Shared by all three items: same source, same window, same kind of claim.
  // Spelled once so the three cannot drift into describing different reads of
  // what was a single query.
  //
  // A function rather than a constant so each item gets its own `limitations`
  // array. One shared empty array would be a single instance behind all three,
  // and a later consumer pushing a limitation onto one item would silently add
  // it to the other two.
  const common = () =>
    ({
      schemaVersion: INTELLIGENCE_RECOMMENDATION_EVIDENCE_SCHEMA_VERSION,
      semanticKind: 'factual_observation',
      provenance: AUTOMATION_FAILURE_PROVENANCE,
      limitations: [],
      ...(sample.window ? { window: sample.window } : {}),
    }) satisfies Partial<LeadFlowIntelligenceEvidence>;

  return {
    confidence,
    policy: toPolicyRef(policy),
    evidence: [
      {
        ...common(),
        ref: `leadflow_automation_runs:${sample.automationId}:terminal_live`,
        label: 'Execuções live concluídas ou falhas',
        metric: 'terminalLiveRuns',
        value: terminalLiveRuns,
        unit: 'runs',
        additivity: 'sum',
        formula: 'succeeded_runs + failed_runs',
      },
      {
        ...common(),
        ref: `leadflow_automation_runs:${sample.automationId}:failed`,
        label: 'Execuções live com falha',
        metric: 'failedRuns',
        value: sample.failedRuns,
        unit: 'runs',
        additivity: 'sum',
        formula: "count(run.status = 'failed')",
      },
      {
        ...common(),
        ref: `leadflow_automation_runs:${sample.automationId}:failure_rate`,
        label: 'Taxa de falha entre desfechos live',
        metric: 'failureRate',
        value: round(failureRate),
        unit: 'ratio',
        // A quotient, not a flow. Averaging two periods' failure rates is not
        // the failure rate of the two periods together unless both had the same
        // number of terminal runs — the weight is not carried here, so the rate
        // must be recomputed from the counts rather than combined.
        additivity: 'average',
        formula: 'failed_runs / (succeeded_runs + failed_runs)',
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
