import {
  LeadScoreFeatureKey,
  LeadScoreRuleId,
  maxAchievableScore,
  resolveBand,
  type LeadScoreBreakdownEntry,
  type LeadScoreCalculation,
  type LeadScoreFeature,
  type LeadScoreFeatureSet,
  type LeadScorePolicy,
  type LeadScoreRuleSpec,
} from '../lead-score.types';

/** Inbound messages that count as an engaged conversation. */
const ENGAGED_INBOUND_THRESHOLD = 3;

/**
 * Turns a policy and a feature set into a score.
 *
 * A pure function, deliberately not a service: no I/O, no clock, no repository.
 * That is what makes the result reproducible — feeding the same features and
 * the same policy version to this function years later must produce the number
 * the snapshot recorded.
 *
 * Always a full recalculation from the complete feature set. There is no
 * incremental path: adding points per event would drift the moment an event was
 * replayed, delivered twice or delivered out of order, and no amount of
 * idempotency around the edges would repair a total assembled that way.
 */
export function calculateLeadScore(
  policy: LeadScorePolicy,
  features: LeadScoreFeatureSet,
  calculatedAt: Date,
): LeadScoreCalculation {
  const breakdown: LeadScoreBreakdownEntry[] = [];
  let subtotal = 0;
  let terminalOverride: LeadScoreRuleId | null = null;
  let overrideScore: number | null = null;

  for (const rule of policy.rules) {
    const entry = evaluateRule(policy, rule, features);
    breakdown.push(entry);

    if (entry.outcome !== 'contributed') continue;

    if (rule.kind === 'terminal_override') {
      // First terminal override in policy order wins. Later contributions are
      // still recorded so the breakdown shows what the lead had achieved before
      // the deal was written off.
      if (terminalOverride === null) {
        terminalOverride = rule.id;
        overrideScore = rule.overrideScore ?? policy.minScore;
      }
      continue;
    }

    subtotal += entry.appliedPoints;
  }

  const raw = overrideScore ?? subtotal;
  const score = clamp(raw, policy.minScore, policy.maxScore);

  return {
    score,
    band: resolveBand(policy, score),
    policyVersion: policy.policyVersion,
    featureSchemaVersion: policy.featureSchemaVersion,
    maxAchievable: maxAchievableScore(policy),
    breakdown,
    features,
    terminalOverride,
    calculatedAt,
  };
}

function evaluateRule(
  policy: LeadScorePolicy,
  rule: LeadScoreRuleSpec,
  features: LeadScoreFeatureSet,
): LeadScoreBreakdownEntry {
  const base = {
    ruleId: rule.id,
    label: rule.label,
    policyVersion: policy.policyVersion,
    possiblePoints: rule.points,
    owningDomain: rule.owningDomain,
  };

  // A rule the policy never activated is reported as such. It is not a lead
  // that failed a test — nothing tested it.
  if (rule.availability !== 'active') {
    return {
      ...base,
      outcome: rule.availability === 'planned' ? 'planned' : 'unavailable',
      observed: {},
      appliedPoints: 0,
      reasonCode:
        rule.availability === 'planned'
          ? 'rule_not_implemented'
          : 'dependency_unavailable',
      evidence: [],
    };
  }

  const missing = rule.features.filter(
    (key) => features[key]?.available !== true,
  );
  if (missing.length > 0) {
    const gap = features[missing[0]];
    return {
      ...base,
      outcome:
        gap?.available === false && gap.reason === 'no_canonical_link'
          ? 'not_applicable'
          : 'unavailable',
      observed: {},
      appliedPoints: 0,
      reasonCode: gap?.available === false ? gap.reason : 'feature_not_loaded',
      evidence: [],
    };
  }

  switch (rule.id) {
    case LeadScoreRuleId.ChannelOrigin: {
      const originated = boolOf(
        features[LeadScoreFeatureKey.OriginatedFromChannel],
      );
      return decide(base, originated, {
        originatedFromChannel: originated,
      });
    }

    case LeadScoreRuleId.LeadReplied: {
      const count = numberOf(features[LeadScoreFeatureKey.InboundMessageCount]);
      return decide(base, count >= 1, { inboundMessageCount: count });
    }

    case LeadScoreRuleId.EngagedConversation: {
      const count = numberOf(features[LeadScoreFeatureKey.InboundMessageCount]);
      return decide(base, count >= ENGAGED_INBOUND_THRESHOLD, {
        inboundMessageCount: count,
        threshold: ENGAGED_INBOUND_THRESHOLD,
      });
    }

    case LeadScoreRuleId.QualificationFields: {
      const total = numberOf(
        features[LeadScoreFeatureKey.EssentialFieldsTotal],
      );
      const present = numberOf(
        features[LeadScoreFeatureKey.EssentialFieldsPresent],
      );
      // A Business Mode that declares no essential fields cannot certify a lead
      // as qualified; "nothing was required" is not evidence of completeness.
      if (total === 0) {
        return {
          ...base,
          outcome: 'not_applicable',
          observed: { essentialFieldsTotal: 0, essentialFieldsPresent: 0 },
          appliedPoints: 0,
          reasonCode: 'no_essential_fields_declared',
          evidence: [],
        };
      }
      return decide(base, present >= total, {
        essentialFieldsTotal: total,
        essentialFieldsPresent: present,
      });
    }

    case LeadScoreRuleId.LostOrDiscarded: {
      const status = stringOf(features[LeadScoreFeatureKey.LifecycleStatus]);
      const stageIsLost = boolOf(features[LeadScoreFeatureKey.StageIsLost]);
      const written_off =
        status === 'lost' || status === 'discarded' || stageIsLost;
      return decide(base, written_off, {
        lifecycleStatus: status,
        stageIsLost,
      });
    }

    default:
      // An active rule with no evaluator would otherwise score silently as
      // zero. Reporting it as unavailable keeps the policy honest.
      return {
        ...base,
        outcome: 'unavailable',
        observed: {},
        appliedPoints: 0,
        reasonCode: 'evaluator_missing',
        evidence: [],
      };
  }
}

function decide(
  base: Pick<
    LeadScoreBreakdownEntry,
    'ruleId' | 'label' | 'policyVersion' | 'possiblePoints' | 'owningDomain'
  >,
  met: boolean,
  observed: Record<string, number | boolean | string | null>,
): LeadScoreBreakdownEntry {
  return {
    ...base,
    outcome: met ? 'contributed' : 'not_met',
    observed,
    appliedPoints: met ? base.possiblePoints : 0,
    reasonCode: met ? 'condition_met' : 'condition_not_met',
    evidence: [],
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function numberOf(feature: LeadScoreFeature | undefined): number {
  return feature?.available === true && typeof feature.value === 'number'
    ? feature.value
    : 0;
}

function boolOf(feature: LeadScoreFeature | undefined): boolean {
  return feature?.available === true && feature.value === true;
}

function stringOf(feature: LeadScoreFeature | undefined): string {
  return feature?.available === true && typeof feature.value === 'string'
    ? feature.value
    : '';
}
