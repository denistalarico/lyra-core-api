import {
  LeadScoreFeatureKey,
  LeadScoreRuleId,
  type LeadScorePolicy,
  type LeadScoreRuleSpec,
} from '../lead-score.types';
import { LEAD_SCORE_POLICY_V1 } from './lead-score-rules-v1.policy';

export const LEAD_SCORE_POLICY_VERSION_V2 = 'lead-score-rules-v2';
export const LEAD_SCORE_FEATURE_SCHEMA_V2 = 'lead-score-features-v2';

/**
 * V1 plus the two Agenda rules, now that LeadFlow appointments exist.
 *
 * Both read one feature — the outcome of the opportunity's latest
 * non-cancelled appointment — so they can never apply together: a confirmed or
 * attended meeting earns the points, a no-show takes them back as a penalty,
 * and a new confirmed meeting after a no-show restores them. The no-show comes
 * either from the operator ("Não compareceu") or from the no-show recovery
 * automation, when it is enabled.
 *
 * A new version rather than an edit of V1: snapshots record the policy that
 * produced them, and V1 snapshots must keep meaning what they meant.
 */
const AGENDA_RULES: Partial<Record<LeadScoreRuleId, Partial<LeadScoreRuleSpec>>> =
  {
    [LeadScoreRuleId.MeetingAccepted]: {
      label: 'Reunião confirmada ou realizada',
      availability: 'active',
      features: [LeadScoreFeatureKey.LatestAppointmentOutcome],
      blockedReason: undefined,
    },
    [LeadScoreRuleId.MeetingNoShow]: {
      availability: 'active',
      features: [LeadScoreFeatureKey.LatestAppointmentOutcome],
      blockedReason: undefined,
    },
  };

export const LEAD_SCORE_POLICY_V2: LeadScorePolicy = {
  ...LEAD_SCORE_POLICY_V1,
  policyVersion: LEAD_SCORE_POLICY_VERSION_V2,
  featureSchemaVersion: LEAD_SCORE_FEATURE_SCHEMA_V2,
  rules: LEAD_SCORE_POLICY_V1.rules.map((rule) => ({
    ...rule,
    ...AGENDA_RULES[rule.id],
  })),
};
