import {
  LeadScoreFeatureKey,
  LeadScoreRuleId,
  type LeadScorePolicy,
  type LeadScoreRuleSpec,
} from '../lead-score.types';
import { LEAD_SCORE_POLICY_V2 } from './lead-score-rules-v2.policy';

export const LEAD_SCORE_POLICY_VERSION_V3 = 'lead-score-rules-v3';
export const LEAD_SCORE_FEATURE_SCHEMA_V3 = 'lead-score-features-v3';

const V3_OVERRIDES: Partial<
  Record<LeadScoreRuleId, Partial<LeadScoreRuleSpec>>
> = {
  [LeadScoreRuleId.ChannelOrigin]: {
    points: 0,
    label: 'Origem do atendimento registrada',
  },
  [LeadScoreRuleId.QualificationFields]: {
    points: 25,
    scoringMode: 'proportional',
  },
  [LeadScoreRuleId.LeadReplied]: { points: 20 },
  [LeadScoreRuleId.EngagedConversation]: { points: 15 },
  [LeadScoreRuleId.MeetingAccepted]: {
    availability: 'planned',
    features: [],
    blockedReason:
      'Substituída pelo marco comercial específico do Business Mode na V3.',
  },
  [LeadScoreRuleId.LostOrDiscarded]: {
    kind: 'contribution',
    points: 0,
    overrideScore: undefined,
    label: 'Oportunidade perdida ou descartada (score preservado)',
  },
};

const V3_RULES: LeadScoreRuleSpec[] = [
  ...LEAD_SCORE_POLICY_V2.rules.map((rule) => ({
    ...rule,
    ...V3_OVERRIDES[rule.id],
  })),
  {
    id: LeadScoreRuleId.BasicContact,
    label: 'Contato com nome e telefone ou e-mail válidos',
    points: 10,
    kind: 'contribution',
    availability: 'active',
    group: 'profile',
    owningDomain: 'leadflow_crm',
    features: [LeadScoreFeatureKey.BasicContactValid],
  },
  {
    id: LeadScoreRuleId.BusinessMilestone,
    label: 'Marco comercial do Business Mode',
    points: 25,
    kind: 'contribution',
    availability: 'active',
    group: 'conversion',
    owningDomain: 'leadflow_crm',
    features: [
      LeadScoreFeatureKey.BusinessModeKey,
      LeadScoreFeatureKey.OperationalStatus,
      LeadScoreFeatureKey.LatestAppointmentOutcome,
    ],
  },
  {
    id: LeadScoreRuleId.Won,
    label: 'Oportunidade ganha',
    points: 0,
    kind: 'terminal_override',
    overrideScore: 100,
    availability: 'active',
    group: 'terminal',
    owningDomain: 'leadflow_crm',
    features: [LeadScoreFeatureKey.LifecycleStatus],
  },
];

export const LEAD_SCORE_POLICY_V3: LeadScorePolicy = {
  ...LEAD_SCORE_POLICY_V2,
  policyVersion: LEAD_SCORE_POLICY_VERSION_V3,
  featureSchemaVersion: LEAD_SCORE_FEATURE_SCHEMA_V3,
  rules: V3_RULES,
};
