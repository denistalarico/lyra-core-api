import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import { LeadFlowAutomationCategory } from '../enums/leadflow-automation-category.enum';
import { LeadFlowAutomationDependency } from '../enums/leadflow-automation-dependency.enum';
import type {
  LeadFlowAutomationAction,
  LeadFlowAutomationActionConfig,
  LeadFlowAutomationConditionConfig,
  LeadFlowAutomationCrmPolicy,
  LeadFlowAutomationMessageConfig,
  LeadFlowAutomationSchedulePolicy,
  LeadFlowAutomationTrigger,
  LeadFlowAutomationTriggerConfig,
} from '../types/leadflow-automation.types';

export type LeadFlowAutomationRecipeTier =
  | 'essential'
  | 'optional'
  | 'developer';

/**
 * How a trigger actually reaches the automation. The trigger *key* alone is
 * misleading: several keys in {@link LeadFlowAutomationTrigger} are not domain
 * events at all. Classifying them honestly here is what lets a future runtime
 * pick the right delivery mechanism instead of assuming every trigger arrives
 * as an event.
 *
 *  - `event`    — a real domain event published by an owning module.
 *  - `derived`  — a state or window computed from other signals. Needs a
 *                 detector or an evaluation pass; no event carries it today.
 *  - `schedule` — driven by the clock, not by anything that happened.
 *  - `webhook`  — an inbound external call.
 */
export type LeadFlowAutomationTriggerKind =
  | 'event'
  | 'derived'
  | 'schedule'
  | 'webhook';

/**
 * Honest classification of every trigger key. `business_hours.closed` is the
 * clearest example of the audit finding: it reads like an event but is a window
 * condition evaluated against an incoming message, so it is `derived`.
 */
export const LEADFLOW_AUTOMATION_TRIGGER_KINDS: Record<
  LeadFlowAutomationTrigger,
  LeadFlowAutomationTriggerKind
> = {
  'conversation.created': 'event',
  'conversation.idle': 'derived',
  'conversation.replied': 'event',
  'conversation.handoff_requested': 'event',
  'opportunity.created': 'event',
  'opportunity.updated': 'event',
  'opportunity.stage_changed': 'event',
  'opportunity.score_changed': 'event',
  'opportunity.hot_lead_detected': 'event',
  'opportunity.won': 'event',
  'opportunity.missing_fields_detected': 'derived',
  'appointment.created': 'event',
  'appointment.confirmation_pending': 'derived',
  'appointment.no_show': 'event',
  'appointment.completed': 'event',
  'quote.sent': 'event',
  'quote.idle': 'derived',
  'business_hours.closed': 'derived',
  'developer.webhook.received': 'webhook',
  'schedule.daily': 'schedule',
  'contact.special_date': 'schedule',
};

/**
 * A ready-made automation recipe. Recipes are a pure in-memory catalog (no DB
 * table) — the same pattern used by Agents presets. The active Business Mode is
 * read from LeadFlow Settings; a recipe declares which modes it targets
 * (`'all'` = every mode). Provisioning copies the recipe defaults onto an
 * instance; nothing here is ever executed.
 */
export interface LeadFlowAutomationRecipeCatalogItem {
  key: string;
  name: string;
  description: string;
  category: LeadFlowAutomationCategory;
  tier: LeadFlowAutomationRecipeTier;
  /**
   * Version of this recipe's contract. Bumped whenever defaults or the config
   * schema change in a way an existing instance would notice. Instances record
   * the version they were provisioned from so a catalog upgrade never silently
   * rewrites a published configuration.
   */
  templateVersion: number;
  /** Withdrawn recipes stay readable for existing instances but cannot be provisioned. */
  deprecated: boolean;
  /**
   * Platform capabilities this recipe needs in order to execute. Unmet
   * dependencies block activation — see the dependency registry.
   */
  requiredDependencies: LeadFlowAutomationDependency[];
  /** Business Modes this recipe is designed for. `'all'` = every mode. */
  businessModeKeys: LeadFlowBusinessMode[] | 'all';
  trigger: LeadFlowAutomationTrigger;
  triggerKind: LeadFlowAutomationTriggerKind;
  primaryAction: LeadFlowAutomationAction;
  /** Human explanation of when the recipe fires. */
  whenLabel: string;
  /** Human explanation of the safety limits. */
  limitsLabel: string;
  isDeveloperOnly: boolean;
  requiresApps: string[];
  defaultTriggerConfig: LeadFlowAutomationTriggerConfig;
  defaultConditionConfig: LeadFlowAutomationConditionConfig;
  defaultActionConfig: LeadFlowAutomationActionConfig;
  defaultMessageConfig: LeadFlowAutomationMessageConfig;
  defaultCrmPolicy: LeadFlowAutomationCrmPolicy;
  defaultSchedulePolicy: LeadFlowAutomationSchedulePolicy;
  safetyRules: string[];
}

const {
  ClinicsEsthetics,
  RestaurantsFood,
  RealEstate,
  EducationCourses,
  Automotive,
  LocalServices,
  LegalAccounting,
  FitnessWellness,
  AgencyServices,
  EventsTourism,
} = LeadFlowBusinessMode;

const BASE_SAFETY_RULES = [
  'respect_client_business_hours',
  'stop_on_human_handoff',
  'never_invent_prices_or_availability',
];

/** Modes that run an appointment-style agenda (used by reminder/confirmation/no-show). */
const AGENDA_MODES: LeadFlowBusinessMode[] = [
  ClinicsEsthetics,
  RestaurantsFood,
  RealEstate,
  EducationCourses,
  Automotive,
  LocalServices,
  LegalAccounting,
  FitnessWellness,
  EventsTourism,
];

interface RecipeSeed {
  key: string;
  name: string;
  description: string;
  category: LeadFlowAutomationCategory;
  tier: LeadFlowAutomationRecipeTier;
  templateVersion?: number;
  deprecated?: boolean;
  requiredDependencies: LeadFlowAutomationDependency[];
  businessModeKeys?: LeadFlowBusinessMode[] | 'all';
  trigger: LeadFlowAutomationTrigger;
  primaryAction: LeadFlowAutomationAction;
  whenLabel: string;
  limitsLabel: string;
  isDeveloperOnly?: boolean;
  requiresApps?: string[];
  triggerConfig?: LeadFlowAutomationTriggerConfig;
  conditionConfig?: LeadFlowAutomationConditionConfig;
  actionConfig?: LeadFlowAutomationActionConfig;
  messageConfig?: LeadFlowAutomationMessageConfig;
  crmPolicy?: LeadFlowAutomationCrmPolicy;
  schedulePolicy?: LeadFlowAutomationSchedulePolicy;
  extraSafetyRules?: string[];
}

function buildRecipe(seed: RecipeSeed): LeadFlowAutomationRecipeCatalogItem {
  return {
    key: seed.key,
    name: seed.name,
    description: seed.description,
    category: seed.category,
    tier: seed.tier,
    templateVersion: seed.templateVersion ?? 2,
    deprecated: seed.deprecated ?? false,
    requiredDependencies: [...seed.requiredDependencies],
    businessModeKeys: seed.businessModeKeys ?? 'all',
    trigger: seed.trigger,
    triggerKind: LEADFLOW_AUTOMATION_TRIGGER_KINDS[seed.trigger],
    primaryAction: seed.primaryAction,
    whenLabel: seed.whenLabel,
    limitsLabel: seed.limitsLabel,
    isDeveloperOnly: seed.isDeveloperOnly ?? false,
    requiresApps: seed.requiresApps ?? [],
    defaultTriggerConfig: { type: seed.trigger, ...(seed.triggerConfig ?? {}) },
    defaultConditionConfig: {
      businessHoursOnly: true,
      // A `null` instance value delegates to the global consent policy. The
      // resolver keeps a true global requirement monotonic.
      requireExplicitConsent: null,
      stopIfReplied: true,
      stopIfHandoff: true,
      ...(seed.conditionConfig ?? {}),
    },
    defaultActionConfig: {
      primaryAction: seed.primaryAction,
      requireHumanApproval: false,
      ...(seed.actionConfig ?? {}),
    },
    defaultMessageConfig: {
      channel: null,
      templateRef: null,
      ...(seed.messageConfig ?? {}),
    },
    defaultCrmPolicy: {
      moveStageOnComplete: null,
      moveStageReasonCode: null,
      transferToPipelineRef: null,
      transferToStageRef: null,
      transferReasonCode: null,
      copyToPipelineRef: null,
      copyToStageRef: null,
      copyReasonCode: null,
      ...(seed.crmPolicy ?? {}),
    },
    defaultSchedulePolicy: {
      respectBusinessHours: true,
      timezone: null,
      ...(seed.schedulePolicy ?? {}),
    },
    safetyRules: [...BASE_SAFETY_RULES, ...(seed.extraSafetyRules ?? [])],
  };
}

const ESSENTIAL_SEEDS: RecipeSeed[] = [
  {
    key: 'followup_idle_lead',
    // v4: the cadence became a closed vocabulary (d0/d1/d3/d7) instead of an
    // open list of delays. See followup-plan.catalog.ts.
    templateVersion: 4,
    requiredDependencies: [
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.SchedulerRuntime,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Follow-up automático',
    description:
      'Retoma o lead que parou de responder, em até quatro tentativas, e para sozinho quando ele volta a falar.',
    category: LeadFlowAutomationCategory.Followup,
    tier: 'essential',
    trigger: 'conversation.idle',
    primaryAction: 'schedule_followup',
    whenLabel: 'Quando o lead deixa a última mensagem sem resposta.',
    limitsLabel:
      'Para assim que o lead responder, se houver handoff, e respeita o modo de follow-up de cada oportunidade.',
    // Kept for instances provisioned before the derived trigger: the detector
    // now wakes at the earliest enabled attempt, and only falls back to this.
    triggerConfig: { delayHours: 22 },
    conditionConfig: {},
    actionConfig: { maxAttempts: 4 },
    messageConfig: {
      baseMessage:
        'Olá! Podemos continuar seu atendimento? Se ainda tiver interesse, responda a esta mensagem.',
      followupSteps: [
        { stepKey: 'd0', enabled: true, delayMinutes: 180, channels: [] },
        { stepKey: 'd1', enabled: true, delayMinutes: 1320, channels: [] },
        { stepKey: 'd3', enabled: false, delayMinutes: 4320, channels: [] },
        { stepKey: 'd7', enabled: false, delayMinutes: 10080, channels: [] },
      ],
    },
    schedulePolicy: { cooldownHours: 24 },
  },
  {
    key: 'appointment_reminder',
    templateVersion: 3,
    requiredDependencies: [
      LeadFlowAutomationDependency.AgendaDomain,
      LeadFlowAutomationDependency.SchedulerRuntime,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Lembrete pré-agenda',
    description:
      'Lembra o lead antes de uma reunião, consulta, visita, reserva ou avaliação.',
    category: LeadFlowAutomationCategory.Appointments,
    tier: 'essential',
    businessModeKeys: AGENDA_MODES,
    trigger: 'appointment.created',
    primaryAction: 'schedule_appointment_reminder',
    whenLabel: 'Antes do horário agendado (24h, 2h e 30min).',
    limitsLabel:
      'Só agenda antecedências que ainda não passaram; cancela sozinho se o compromisso for cancelado, remarcado ou assumido por uma pessoa.',
    // A reminder belongs to the appointment's clock, not to the office's: a 7h
    // appointment needs its 30-minute reminder at 6h30. Reply history is
    // likewise irrelevant — being reminded is not a conversation to abandon
    // because the lead once wrote to us.
    conditionConfig: { businessHoursOnly: false, stopIfReplied: false },
    messageConfig: {
      baseMessage:
        'Olá! Passando para lembrar do seu compromisso. Se precisar remarcar, é só responder por aqui.',
    },
    schedulePolicy: {
      respectBusinessHours: false,
      offsets: [
        { label: '24h antes', minutesBefore: 24 * 60 },
        { label: '2h antes', minutesBefore: 2 * 60 },
        { label: '30min antes', minutesBefore: 30 },
      ],
    },
  },
  {
    key: 'appointment_confirmation',
    templateVersion: 3,
    requiredDependencies: [
      LeadFlowAutomationDependency.AgendaDomain,
      LeadFlowAutomationDependency.SchedulerRuntime,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Confirmação de agenda',
    description: 'Pergunta ao lead se ele confirma a presença no compromisso.',
    category: LeadFlowAutomationCategory.Appointments,
    tier: 'essential',
    businessModeKeys: AGENDA_MODES,
    trigger: 'appointment.confirmation_pending',
    primaryAction: 'send_message',
    // The event already means "the window to ask has been reached" — the Agenda
    // decides when a commitment enters `pending`. Adding a timer here would
    // delay the question past the deadline it exists to beat.
    whenLabel:
      'Assim que o compromisso entra em confirmação pendente na Agenda.',
    limitsLabel:
      'Uma pergunta por ciclo de confirmação; para se houver atendimento humano em curso.',
    conditionConfig: { businessHoursOnly: false, stopIfReplied: false },
    triggerConfig: { confirmationHoursBefore: 24 },
    messageConfig: {
      baseMessage:
        'Podemos confirmar seu compromisso? Responda Confirmar, Reagendar ou Cancelar.',
      quickReplies: ['Confirmar', 'Reagendar', 'Cancelar'],
    },
  },
  {
    key: 'appointment_no_show_recovery',
    templateVersion: 3,
    requiredDependencies: [
      LeadFlowAutomationDependency.AgendaDomain,
      LeadFlowAutomationDependency.SchedulerRuntime,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'No-show / não compareceu',
    description:
      'Recupera o lead que não compareceu e tenta reagendar o compromisso.',
    category: LeadFlowAutomationCategory.Appointments,
    tier: 'essential',
    businessModeKeys: AGENDA_MODES,
    trigger: 'appointment.no_show',
    primaryAction: 'schedule_followup',
    whenLabel:
      'Uma hora depois do não comparecimento, e de novo no dia seguinte.',
    limitsLabel:
      'Duas tentativas por compromisso, dentro do horário comercial, encerradas assim que o lead responder.',
    conditionConfig: { businessHoursOnly: false, stopIfReplied: false },
    triggerConfig: { delayHours: 1, noShowGraceMinutes: 30 },
    actionConfig: { maxAttempts: 2, moveToStageRef: null },
    messageConfig: {
      baseMessage:
        'Sentimos sua falta no horário combinado. Quer remarcar? Responda por aqui que eu ajudo.',
    },
    schedulePolicy: { cooldownHours: 24 },
    crmPolicy: { moveStageOnComplete: null },
  },
  {
    key: 'hot_lead_notification',
    templateVersion: 3,
    requiredDependencies: [
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.LeadScoreEngine,
    ],
    name: 'Lead quente detectado',
    description:
      'Avisa o responsável quando o score/intenção do lead ultrapassa um limiar.',
    category: LeadFlowAutomationCategory.LeadSignals,
    tier: 'essential',
    trigger: 'opportunity.hot_lead_detected',
    primaryAction: 'notify_user',
    whenLabel: 'Quando o score do lead cruza o limiar configurado.',
    limitsLabel:
      'Movimentação de etapa exige aprovação humana quando configurada.',
    conditionConfig: { minScore: 70, intents: [] },
    actionConfig: {
      targetUserRef: null,
      notifyOpportunityOwner: true,
      notifyPipelineOwner: false,
      notifyPipelineParticipants: false,
      specificRecipientUserRefs: [],
      notificationChannels: ['in_app'],
      requireHumanApproval: true,
    },
  },
  {
    key: 'outside_business_hours',
    // v4: the recipe carries its own schedule, so the operator can answer
    // earlier than the hours the Inbox considers open.
    templateVersion: 4,
    requiredDependencies: [
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Fora do horário',
    description:
      'Responde automaticamente quando ninguém pode atender: o lead escreve num canal sem agente, ou pede um humano fora do horário de atendimento.',
    category: LeadFlowAutomationCategory.Availability,
    tier: 'essential',
    trigger: 'business_hours.closed',
    primaryAction: 'send_message',
    whenLabel:
      'Fora do horário, quando nenhum agente está atendendo o canal ou o lead pediu um humano.',
    limitsLabel:
      'Uma resposta por conversa em cada período fechado; se o agente estiver atendendo, quem responde é ele.',
    // `stopIfHandoff` defaults to true for every recipe, and for this one it is
    // backwards: a handoff request outside hours is the very moment this
    // automation exists for, so inheriting "cancel while a handoff is open"
    // made it cancel itself. The same goes for a reply — the lead writing again
    // at midnight is what there is to answer.
    conditionConfig: {
      businessHoursOnly: false,
      stopIfReplied: false,
      stopIfHandoff: false,
    },
    actionConfig: { primaryAction: 'send_message' },
    messageConfig: {
      baseMessage:
        'No momento estamos fora do horário de atendimento. Assim que retornarmos, vamos responder por aqui.',
    },
    // Null inherits the workspace schedule configured for the Inbox — the same
    // one the rest of LeadFlow reads — until an operator sets a custom one.
    schedulePolicy: { respectBusinessHours: false, businessHours: null },
  },
  {
    key: 'governed_stage_advance',
    // The only capability the platform can execute end-to-end today: a governed,
    // non-terminal stage transition. Requires the canonical command; delivery
    // still needs the durable fan-out. Deliberately has no secondary action, so
    // the one effect it performs is the one the executor can actually carry out.
    requiredDependencies: [
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.StageTransitionCommand,
    ],
    name: 'Avançar etapa automaticamente',
    description:
      'Avança a oportunidade para a próxima etapa assim que os requisitos governados da transição são atendidos. Nunca move para etapas de ganho ou perda.',
    category: LeadFlowAutomationCategory.Routing,
    tier: 'essential',
    trigger: 'opportunity.updated',
    primaryAction: 'move_opportunity_stage',
    whenLabel:
      'Quando os campos e condições exigidos pela política de transição são preenchidos.',
    limitsLabel:
      'Só entre etapas não terminais; respeita a política de transição publicada e o motivo governado.',
    conditionConfig: {
      businessHoursOnly: false,
      stopIfReplied: false,
      stopIfHandoff: false,
    },
    // The target stage and reason are per-instance: an operator picks which
    // stage this advances to. Null until configured, so the automation stays in
    // "requires configuration" rather than guessing a destination.
    crmPolicy: { moveStageOnComplete: null, moveStageReasonCode: null },
  },
];

const OPTIONAL_SEEDS: RecipeSeed[] = [
  {
    key: 'daily_opportunity_summary',
    // v4: cadence (daily/weekly/monthly), configurable notification channels
    // and delivery into a Team Chat channel as the agent.
    templateVersion: 4,
    requiredDependencies: [
      LeadFlowAutomationDependency.SchedulerRuntime,
      LeadFlowAutomationDependency.EventFanOut,
    ],
    name: 'Resumo de oportunidades',
    description:
      'Entrega um resumo real das oportunidades para a equipe, na frequência escolhida.',
    category: LeadFlowAutomationCategory.Reporting,
    tier: 'optional',
    trigger: 'schedule.daily',
    primaryAction: 'generate_summary_placeholder',
    whenLabel: 'Na frequência e no horário configurados.',
    limitsLabel: 'Somente comunicação interna; nenhum contato com o lead.',
    conditionConfig: {
      businessHoursOnly: false,
      stopIfReplied: false,
      stopIfHandoff: false,
    },
    actionConfig: {
      targetUserRef: null,
      notificationChannels: ['in_app'],
      deliverToTeamChat: false,
      teamChatChannelId: null,
    },
    schedulePolicy: {
      respectBusinessHours: false,
      timezone: 'America/Sao_Paulo',
      frequency: 'daily',
      dailyTime: '08:00',
      weekday: null,
      dayOfMonth: null,
    },
  },
  {
    key: 'lead_distribution',
    // v3: the new owner is told over the configured channels.
    templateVersion: 3,
    requiredDependencies: [
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.LeadDistributionCommand,
    ],
    name: 'Distribuição de leads',
    description:
      'Distribui novas oportunidades entre responsáveis conforme a regra configurada.',
    category: LeadFlowAutomationCategory.Routing,
    tier: 'optional',
    businessModeKeys: [RealEstate, AgencyServices, Automotive, LocalServices],
    trigger: 'opportunity.created',
    primaryAction: 'assign_opportunity_owner',
    whenLabel: 'Quando uma nova oportunidade é criada.',
    limitsLabel: 'Distribuição interna; não envia mensagem ao lead.',
    conditionConfig: { businessHoursOnly: false, stopIfReplied: false },
    actionConfig: {
      distributionStrategy: 'least_volume',
      notificationChannels: ['in_app'],
    },
  },
  {
    key: 'automatic_tagging',
    // v4: the single field/operator/value rule became a list of rules, each
    // carrying the tags it applies. See `conditions.tagRules`.
    templateVersion: 4,
    requiredDependencies: [LeadFlowAutomationDependency.EventFanOut],
    name: 'Tag automática',
    description:
      'Aplica tags à oportunidade com base em critérios simples da conversa.',
    category: LeadFlowAutomationCategory.Tagging,
    tier: 'optional',
    trigger: 'opportunity.created',
    primaryAction: 'add_tag',
    whenLabel: 'Quando uma nova oportunidade é criada.',
    limitsLabel: 'Apenas organização interna; sem envio de mensagem.',
    conditionConfig: {
      businessHoursOnly: false,
      stopIfReplied: false,
      tagRules: [],
    },
  },
  {
    key: 'post_service_csat',
    templateVersion: 3,
    requiredDependencies: [
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.SchedulerRuntime,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Avaliação do atendimento',
    description:
      'Solicita uma avaliação simples do atendimento e registra a resposta de 1 a 5.',
    category: LeadFlowAutomationCategory.Feedback,
    tier: 'optional',
    trigger: 'opportunity.won',
    primaryAction: 'request_csat',
    whenLabel: 'Quando uma oportunidade é marcada como ganha.',
    limitsLabel:
      'Um pedido por ciclo; aceita somente notas inteiras de 1 a 5 e respeita opt-out.',
    conditionConfig: {
      businessHoursOnly: false,
      stopIfReplied: false,
      stopIfHandoff: false,
    },
    messageConfig: {
      channel: 'whatsapp',
      baseMessage:
        'Como você avalia nosso atendimento? Responda somente com uma nota de 1 a 5, sendo 1 muito insatisfeito e 5 muito satisfeito.',
      quickReplies: ['1', '2', '3', '4', '5'],
    },
    schedulePolicy: {
      respectBusinessHours: false,
      responseWindowHours: 168,
    },
    extraSafetyRules: [
      'respect_explicit_contact_opt_out',
      'never_use_zero_for_missing_csat_response',
    ],
  },
  {
    key: 'developer_webhook',
    requiredDependencies: [
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.WebhookDispatch,
    ],
    name: 'Webhook developer',
    description:
      'Conecta eventos do LeadFlow a um endpoint externo via webhook (somente developer).',
    category: LeadFlowAutomationCategory.Developer,
    tier: 'developer',
    trigger: 'developer.webhook.received',
    primaryAction: 'send_webhook',
    whenLabel: 'Quando um evento configurado ocorre (contrato de webhook).',
    limitsLabel:
      'Desativado por padrão; exige permissão de developer e publicação explícita. Nenhum disparo real neste sprint.',
    isDeveloperOnly: true,
    conditionConfig: {
      businessHoursOnly: false,
      stopIfReplied: false,
      stopIfHandoff: false,
    },
    actionConfig: { primaryAction: 'send_webhook' },
    extraSafetyRules: ['mask_secrets', 'no_real_dispatch_in_config_phase'],
  },
];

export const LEADFLOW_AUTOMATION_RECIPES: LeadFlowAutomationRecipeCatalogItem[] =
  [...ESSENTIAL_SEEDS, ...OPTIONAL_SEEDS].map(buildRecipe);

/**
 * Recipes withdrawn from the catalog, kept here only as a record of what the
 * keys used to mean. They resolve to nothing — `getRecipeByKey` returns
 * `undefined` — because the instances were deleted by migration
 * `1789700000000`, not left orphaned.
 *
 * Two reasons, and neither is "we did not get around to it":
 *
 *  - **Duplicated the follow-up.** `followup_by_crm_stage`,
 *    `cold_lead_reactivation`, `post_service_followup`, `campaign_followup`,
 *    `quote_recovery`, `missing_fields_request` and `pending_documents` were all
 *    "wait, then send a message". The canonical cadence in `followup_idle_lead`
 *    (d0/d1/d3/d7, per-opportunity mode, agent-written copy) does that job, and
 *    an operator configuring the same thing in seven places configures it wrong
 *    in six.
 *  - **Owned elsewhere.** `automatic_handoff` re-declared a handoff that the
 *    agent already performs through the governed action worker and the
 *    ownership command — including who receives it, configured on the agent.
 *    `birthday_or_special_date` needed a birth date the platform never collects.
 *
 * The trigger vocabulary, the dependency registry and the action list keep the
 * entries these recipes used: they belong to the event contract and to the
 * executor registry, not to the catalog.
 */
export const RETIRED_AUTOMATION_RECIPE_KEYS: readonly string[] = [
  'automatic_handoff',
  'birthday_or_special_date',
  'campaign_followup',
  'cold_lead_reactivation',
  'followup_by_crm_stage',
  'missing_fields_request',
  'pending_documents',
  'post_service_followup',
  'quote_recovery',
];

/**
 * The one recipe whose single effect is a governed stage transition — the first
 * productive executor's target. Named so config validation and the UI can
 * special-case it without matching on a string literal in several places.
 */
export const GOVERNED_STAGE_ADVANCE_RECIPE_KEY = 'governed_stage_advance';

/**
 * The one follow-up recipe. It owns the canonical d0/d1/d3/d7 cadence, so the
 * config schema, the lifecycle and the timer consumer all key off this name
 * instead of listing the several follow-up recipes that used to exist.
 */
export const FOLLOWUP_IDLE_LEAD_RECIPE_KEY = 'followup_idle_lead';

/**
 * The recipe that owns `conditions.tagRules`. Readiness, the payload builder and
 * the dedicated editor all key off this name, because a tag rule is the only
 * configuration shaped like a list of independent decisions.
 */
export const AUTOMATIC_TAGGING_RECIPE_KEY = 'automatic_tagging';

/**
 * The recipe that answers when nobody can. The detector that derives its
 * trigger, its readiness rule and its dedicated editor all key off this name,
 * because it is the only recipe that carries a schedule of its own.
 */
export const OUTSIDE_BUSINESS_HOURS_RECIPE_KEY = 'outside_business_hours';

/** Comparisons a tag rule may make against an opportunity field. */
export const LEADFLOW_TAG_RULE_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'is_present',
] as const;

/**
 * The recipes whose effect includes telling a colleague, over the channels the
 * operator picks in `actions.notificationChannels`. Readiness, the channel
 * availability check and the detail payload all key off this list rather than
 * repeating the recipe names.
 */
export const NOTIFICATION_CHANNEL_RECIPE_KEYS: readonly string[] = [
  'hot_lead_notification',
  'lead_distribution',
  'daily_opportunity_summary',
];

/**
 * The recipe that reports the operation back to the operation. Its cadence, its
 * readiness rules and its Team Chat delivery all key off this name: it is the
 * only recipe whose effect is addressed to the agency rather than to a lead.
 */
export const DAILY_OPPORTUNITY_SUMMARY_RECIPE_KEY = 'daily_opportunity_summary';

const OFFICIAL_BUSINESS_MODES = new Set<string>(
  Object.values(LeadFlowBusinessMode),
);

/** A Business Mode is "custom" when it is not one of the official seeded modes. */
export function isCustomBusinessMode(businessModeKey: string): boolean {
  return !OFFICIAL_BUSINESS_MODES.has(businessModeKey);
}

export function getRecipeByKey(
  recipeKey: string,
): LeadFlowAutomationRecipeCatalogItem | undefined {
  const canonicalKey =
    recipeKey === 'nps_feedback' ? 'post_service_csat' : recipeKey;
  const recipe = LEADFLOW_AUTOMATION_RECIPES.find(
    (item) => item.key === canonicalKey,
  );
  if (!recipe || recipeKey !== 'nps_feedback') return recipe;
  // Existing rows keep their historical key but resolve to the corrected
  // contract. New provisioning only lists/creates `post_service_csat`.
  return { ...recipe, key: 'nps_feedback', deprecated: true };
}

export function listRecipes(): LeadFlowAutomationRecipeCatalogItem[] {
  return LEADFLOW_AUTOMATION_RECIPES;
}

/**
 * Whether a recipe is designed for the given Business Mode. `'all'` recipes and
 * custom (non-official) modes are treated as compatible so essentials always
 * surface; optional recipes narrow by their declared modes.
 */
export function isRecipeCompatible(
  recipe: LeadFlowAutomationRecipeCatalogItem,
  businessModeKey: string,
): boolean {
  if (recipe.businessModeKeys === 'all') {
    return true;
  }
  if (isCustomBusinessMode(businessModeKey)) {
    return true;
  }
  return recipe.businessModeKeys.includes(
    businessModeKey as LeadFlowBusinessMode,
  );
}
