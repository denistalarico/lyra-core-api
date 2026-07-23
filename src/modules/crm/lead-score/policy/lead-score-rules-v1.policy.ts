import {
  LeadScoreFeatureKey,
  LeadScoreRuleId,
  type LeadScorePolicy,
  type LeadScoreRuleSpec,
} from '../lead-score.types';

export const LEAD_SCORE_POLICY_VERSION_V1 = 'lead-score-rules-v1';
export const LEAD_SCORE_FEATURE_SCHEMA_V1 = 'lead-score-features-v1';

/** Score at which a lead is considered hot. Fixed across policy versions. */
export const LEAD_SCORE_HOT_THRESHOLD = 70;

/**
 * The first scoring policy.
 *
 * Every rule the business asked for is listed, including the ones that cannot
 * run: a rule quietly omitted would look like a rule that scored zero, and the
 * difference between "this lead showed no intent" and "nothing in this platform
 * can observe intent" is the whole point of the exercise.
 *
 * Five rules are active, so the highest score this policy can produce is 45 and
 * `hot` is unreachable. That is recorded rather than hidden: the bands stay
 * where they are so scores remain comparable once Appointments and structured
 * intent signals arrive and a later policy activates the remaining rules.
 */
const RULES: LeadScoreRuleSpec[] = [
  {
    id: LeadScoreRuleId.ChannelOrigin,
    label: 'Chegou por um canal de atendimento',
    points: 5,
    kind: 'contribution',
    availability: 'active',
    group: 'profile',
    owningDomain: 'leadflow_crm',
    // An opportunity linked to an inbox conversation demonstrably came from a
    // channel; one created by hand does not. No new field is needed to know it.
    features: [LeadScoreFeatureKey.OriginatedFromChannel],
  },
  {
    id: LeadScoreRuleId.QualificationFields,
    label: 'Informações essenciais de qualificação preenchidas',
    points: 15,
    kind: 'contribution',
    availability: 'active',
    group: 'progress',
    owningDomain: 'leadflow_crm',
    // Merges "required fields filled" and "reached a qualified stage": under
    // this product's definition they are the same fact, and scoring both would
    // award 20 points for one thing happening.
    features: [
      LeadScoreFeatureKey.EssentialFieldsTotal,
      LeadScoreFeatureKey.EssentialFieldsPresent,
    ],
  },
  {
    id: LeadScoreRuleId.LeadReplied,
    label: 'O lead respondeu',
    points: 15,
    kind: 'contribution',
    availability: 'active',
    group: 'engagement',
    owningDomain: 'leadflow_inbox',
    features: [LeadScoreFeatureKey.InboundMessageCount],
  },
  {
    id: LeadScoreRuleId.EngagedConversation,
    label: 'Conversa com pelo menos três mensagens do lead',
    points: 10,
    kind: 'contribution',
    availability: 'active',
    group: 'engagement',
    owningDomain: 'leadflow_inbox',
    features: [LeadScoreFeatureKey.InboundMessageCount],
  },
  {
    id: LeadScoreRuleId.CommercialIntent,
    label: 'Manifestou interesse comercial',
    points: 15,
    kind: 'contribution',
    availability: 'planned',
    group: 'intent',
    owningDomain: 'leadflow_agents',
    features: [],
    blockedReason:
      'Não há sinal estruturado de intenção persistido; o agente ainda não classifica intenção comercial.',
  },
  {
    id: LeadScoreRuleId.PriceRequest,
    label: 'Pediu preço, proposta ou orçamento',
    points: 15,
    kind: 'contribution',
    availability: 'planned',
    group: 'intent',
    owningDomain: 'leadflow_agents',
    features: [],
    blockedReason:
      'Depende do mesmo sinal estruturado de intenção, ainda não produzido.',
  },
  {
    id: LeadScoreRuleId.MeetingAccepted,
    label: 'Confirmou uma reunião',
    points: 20,
    kind: 'contribution',
    availability: 'planned',
    group: 'conversion',
    owningDomain: 'leadflow_agenda',
    features: [],
    blockedReason:
      'O domínio de Agenda do LeadFlow ainda não existe; nenhum agendamento canônico é emitido.',
  },
  {
    id: LeadScoreRuleId.FollowupUnanswered,
    label: 'Follow-up encerrado sem resposta',
    points: -15,
    kind: 'contribution',
    availability: 'planned',
    group: 'penalty',
    owningDomain: 'leadflow_automations',
    features: [],
    blockedReason:
      'Depende de automações executando follow-ups; nenhum executor produtivo está ligado.',
  },
  {
    id: LeadScoreRuleId.MeetingNoShow,
    label: 'Não compareceu à reunião',
    points: -20,
    kind: 'contribution',
    availability: 'planned',
    group: 'penalty',
    owningDomain: 'leadflow_agenda',
    features: [],
    blockedReason: 'Depende do domínio de Agenda do LeadFlow.',
  },
  {
    id: LeadScoreRuleId.NoInterest,
    label: 'Declarou não ter interesse',
    points: -40,
    kind: 'contribution',
    availability: 'planned',
    group: 'penalty',
    owningDomain: 'leadflow_agents',
    features: [],
    blockedReason:
      'Depende do sinal estruturado de intenção, ainda não produzido.',
  },
  {
    id: LeadScoreRuleId.OptOutOrInvalid,
    label: 'Opt-out, spam ou contato inválido',
    points: 0,
    kind: 'terminal_override',
    overrideScore: 0,
    availability: 'planned',
    group: 'terminal',
    owningDomain: 'leadflow_agents',
    features: [],
    blockedReason:
      'Não há registro canônico de consentimento; o status do contato descreve ciclo de vida, não opt-out.',
  },
  {
    id: LeadScoreRuleId.LostOrDiscarded,
    label: 'Oportunidade perdida ou descartada',
    points: 0,
    kind: 'terminal_override',
    overrideScore: 0,
    availability: 'active',
    group: 'terminal',
    owningDomain: 'leadflow_crm',
    features: [
      LeadScoreFeatureKey.LifecycleStatus,
      LeadScoreFeatureKey.StageIsLost,
    ],
  },
];

export const LEAD_SCORE_POLICY_V1: LeadScorePolicy = {
  policyVersion: LEAD_SCORE_POLICY_VERSION_V1,
  featureSchemaVersion: LEAD_SCORE_FEATURE_SCHEMA_V1,
  minScore: 0,
  maxScore: 100,
  bands: [
    { band: 'cold', min: 0, max: 29 },
    { band: 'warm', min: 30, max: 69 },
    { band: 'hot', min: LEAD_SCORE_HOT_THRESHOLD, max: 100 },
  ],
  rules: RULES,
};
