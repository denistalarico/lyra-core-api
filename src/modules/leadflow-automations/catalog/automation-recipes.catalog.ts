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
    templateVersion: 3,
    requiredDependencies: [
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.SchedulerRuntime,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Follow-up de lead sem resposta',
    description:
      'Reengaja automaticamente uma conversa/oportunidade que ficou sem resposta por um período configurado.',
    category: LeadFlowAutomationCategory.Followup,
    tier: 'essential',
    trigger: 'conversation.idle',
    primaryAction: 'schedule_followup',
    whenLabel: 'Quando o lead fica sem responder por 24h (configurável).',
    limitsLabel:
      'Para se o lead responder, se houver handoff ou ao atingir o limite de tentativas.',
    triggerConfig: { delayHours: 24 },
    conditionConfig: {},
    actionConfig: { maxAttempts: 3 },
    messageConfig: {
      baseMessage:
        'Olá! Podemos continuar seu atendimento? Se ainda tiver interesse, responda a esta mensagem.',
      followupSteps: [
        { stepKey: 'd1', delayMinutes: 1440, channels: [] },
        { stepKey: 'd3', delayMinutes: 4320, channels: [] },
        { stepKey: 'd7', delayMinutes: 10080, channels: [] },
      ],
    },
    schedulePolicy: { cooldownHours: 24 },
  },
  {
    key: 'followup_by_crm_stage',
    templateVersion: 3,
    requiredDependencies: [
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.SchedulerRuntime,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Follow-up por etapa do CRM',
    description:
      'Dispara um follow-up conforme a etapa atual da oportunidade e o tempo parado nela.',
    category: LeadFlowAutomationCategory.Followup,
    tier: 'essential',
    trigger: 'opportunity.stage_changed',
    primaryAction: 'schedule_followup',
    whenLabel:
      'Quando a oportunidade permanece numa etapa além do tempo configurado.',
    limitsLabel: 'Respeita limite por oportunidade e horário comercial.',
    triggerConfig: { idleHoursInStage: 48, stageRef: null, pipelineRef: null },
    actionConfig: { maxAttempts: 2 },
    messageConfig: {
      baseMessage:
        'Olá! Podemos continuar seu atendimento? Se ainda tiver interesse, responda a esta mensagem.',
      followupSteps: [
        {
          stepKey: 'stage_followup',
          delayMinutes: 2880,
          channels: [],
        },
      ],
    },
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
    key: 'automatic_handoff',
    requiredDependencies: [
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.OwnershipCommand,
    ],
    name: 'Handoff automático',
    description:
      'Transfere a conversa para um humano quando o contexto exige atendimento pessoal.',
    category: LeadFlowAutomationCategory.Handoff,
    tier: 'essential',
    trigger: 'conversation.handoff_requested',
    primaryAction: 'request_handoff',
    whenLabel:
      'Quando surgem intenções sensíveis, palavras-chave ou pedido explícito de humano.',
    limitsLabel:
      'Respeita horário e responsável definido; registra o motivo do handoff.',
    conditionConfig: { intents: [], keywords: [] },
    actionConfig: { targetUserRef: null },
    extraSafetyRules: ['escalate_sensitive_or_complaint_topics'],
  },
  {
    key: 'outside_business_hours',
    templateVersion: 3,
    requiredDependencies: [
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Fora do horário',
    description:
      'Responde automaticamente quando o lead escreve fora do horário comercial.',
    category: LeadFlowAutomationCategory.Availability,
    tier: 'essential',
    trigger: 'business_hours.closed',
    primaryAction: 'send_message',
    whenLabel: 'Quando chega mensagem fora do horário comercial configurado.',
    limitsLabel:
      'Informa o próximo horário de retorno; pode criar tarefa/follow.',
    conditionConfig: { businessHoursOnly: false, stopIfReplied: false },
    actionConfig: { primaryAction: 'send_message' },
    messageConfig: {
      baseMessage:
        'No momento estamos fora do horário de atendimento. Assim que retornarmos, vamos responder por aqui.',
    },
    schedulePolicy: { respectBusinessHours: false },
  },
  {
    key: 'missing_fields_request',
    requiredDependencies: [
      LeadFlowAutomationDependency.MissingFieldsDetector,
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Campos faltantes',
    description:
      'Solicita dados mínimos ausentes do contato/oportunidade de forma guiada.',
    category: LeadFlowAutomationCategory.DataQuality,
    tier: 'essential',
    trigger: 'opportunity.missing_fields_detected',
    primaryAction: 'request_missing_fields',
    whenLabel:
      'Quando faltam campos obrigatórios definidos pelo Business Mode.',
    limitsLabel:
      'Limite de perguntas por mensagem; para se o lead demonstrar frustração.',
    conditionConfig: { requiredFields: [] },
    actionConfig: { maxAttempts: 2 },
    crmPolicy: { appendNote: true },
  },
  {
    key: 'post_service_followup',
    templateVersion: 3,
    requiredDependencies: [
      LeadFlowAutomationDependency.AgendaDomain,
      LeadFlowAutomationDependency.SchedulerRuntime,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Pós-atendimento',
    description:
      'Envia agradecimento e próximo passo após o atendimento/compromisso ser concluído.',
    category: LeadFlowAutomationCategory.PostService,
    tier: 'essential',
    trigger: 'appointment.completed',
    primaryAction: 'schedule_followup',
    whenLabel: 'Duas horas depois do compromisso concluído.',
    limitsLabel:
      'Um envio por compromisso concluído, em horário comercial, respeitando o intervalo mínimo.',
    conditionConfig: { businessHoursOnly: false, stopIfReplied: false },
    triggerConfig: { delayHours: 2 },
    messageConfig: {
      baseMessage:
        'Obrigado pela visita! Como foi sua experiência? Se precisar de qualquer coisa, é só responder por aqui.',
    },
    schedulePolicy: { cooldownHours: 72 },
    crmPolicy: { moveStageOnComplete: null, addTags: [] },
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
    key: 'quote_recovery',
    requiredDependencies: [
      LeadFlowAutomationDependency.QuotesDomain,
      LeadFlowAutomationDependency.SchedulerRuntime,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Recuperação de orçamento',
    description:
      'Retoma leads com orçamento/proposta enviado que ficaram sem resposta.',
    category: LeadFlowAutomationCategory.Retention,
    tier: 'optional',
    businessModeKeys: [
      AgencyServices,
      RealEstate,
      Automotive,
      LocalServices,
      EducationCourses,
    ],
    trigger: 'quote.idle',
    primaryAction: 'schedule_followup',
    whenLabel: 'Quando um orçamento enviado fica parado sem resposta.',
    limitsLabel: 'Limite de tentativas; para se o lead responder ou fechar.',
    triggerConfig: { delayHours: 48 },
    actionConfig: { maxAttempts: 2 },
  },
  {
    key: 'cold_lead_reactivation',
    templateVersion: 4,
    requiredDependencies: [
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.SchedulerRuntime,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Reativação de lead frio',
    description: 'Reengaja leads antigos e inativos com uma nova abordagem.',
    category: LeadFlowAutomationCategory.Retention,
    tier: 'optional',
    trigger: 'conversation.idle',
    primaryAction: 'schedule_followup',
    whenLabel: 'Quando o lead está inativo há um longo período.',
    limitsLabel: 'Baixa frequência; respeita opt-out e cooldown longo.',
    triggerConfig: { delayHours: 720 },
    conditionConfig: {
      businessHoursOnly: true,
      stopIfReplied: true,
      stopIfHandoff: true,
    },
    actionConfig: { maxAttempts: 1 },
    messageConfig: {
      baseMessage:
        'Olá! Faz algum tempo desde nosso último contato. Se ainda fizer sentido para você, responda a esta mensagem e retomamos por aqui.',
      followupSteps: [
        {
          stepKey: 'reactivation_30d',
          delayMinutes: 720 * 60,
          channels: [],
        },
      ],
    },
    schedulePolicy: { cooldownHours: 720 },
    extraSafetyRules: [
      'respect_explicit_contact_opt_out',
      'limit_reactivation_attempts',
    ],
  },
  {
    key: 'daily_opportunity_summary',
    templateVersion: 3,
    requiredDependencies: [
      LeadFlowAutomationDependency.SchedulerRuntime,
      LeadFlowAutomationDependency.EventFanOut,
    ],
    name: 'Resumo diário de oportunidades',
    description:
      'Envia aos responsáveis um resumo real das oportunidades do dia.',
    category: LeadFlowAutomationCategory.Reporting,
    tier: 'optional',
    trigger: 'schedule.daily',
    primaryAction: 'generate_summary_placeholder',
    whenLabel: 'Uma vez por dia, no horário configurado.',
    limitsLabel: 'Somente notificação interna; nenhum contato com o lead.',
    conditionConfig: {
      businessHoursOnly: false,
      stopIfReplied: false,
      stopIfHandoff: false,
    },
    actionConfig: { targetUserRef: null },
    schedulePolicy: {
      respectBusinessHours: false,
      timezone: 'America/Sao_Paulo',
      dailyTime: '08:00',
    },
  },
  {
    key: 'lead_distribution',
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
    actionConfig: { distributionStrategy: 'least_volume' },
  },
  {
    key: 'automatic_tagging',
    templateVersion: 3,
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
      keywords: [],
      ruleField: 'source',
      ruleOperator: 'is_present',
      ruleValue: null,
    },
    actionConfig: { primaryAction: 'add_tag', addTags: [] },
    crmPolicy: { addTags: [] },
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
    key: 'birthday_or_special_date',
    requiredDependencies: [
      LeadFlowAutomationDependency.SchedulerRuntime,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Aniversário / data especial',
    description:
      'Envia uma mensagem em aniversário ou data especial do contato.',
    category: LeadFlowAutomationCategory.Lifecycle,
    tier: 'optional',
    trigger: 'contact.special_date',
    primaryAction: 'send_message',
    whenLabel: 'Na data especial cadastrada do contato.',
    limitsLabel: 'Uma vez por data; respeita opt-out.',
    conditionConfig: { businessHoursOnly: true, stopIfReplied: false },
  },
  {
    key: 'pending_documents',
    requiredDependencies: [
      LeadFlowAutomationDependency.MissingFieldsDetector,
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Documentos pendentes',
    description: 'Solicita documentos pendentes necessários para avançar.',
    category: LeadFlowAutomationCategory.Documents,
    tier: 'optional',
    businessModeKeys: [
      LegalAccounting,
      EducationCourses,
      RealEstate,
      Automotive,
    ],
    trigger: 'opportunity.missing_fields_detected',
    primaryAction: 'request_missing_fields',
    whenLabel: 'Quando faltam documentos obrigatórios no processo.',
    limitsLabel: 'Limite de lembretes; para ao receber os documentos.',
    conditionConfig: { requiredFields: [] },
    actionConfig: { maxAttempts: 3 },
  },
  {
    key: 'campaign_followup',
    requiredDependencies: [
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.SchedulerRuntime,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Follow-up de campanha',
    description:
      'Acompanha leads originados de uma campanha específica com uma sequência dedicada.',
    category: LeadFlowAutomationCategory.Followup,
    tier: 'optional',
    trigger: 'conversation.created',
    primaryAction: 'schedule_followup',
    whenLabel: 'Quando chega um lead de uma campanha marcada.',
    limitsLabel: 'Para se o lead responder ou for qualificado.',
    conditionConfig: { keywords: [] },
    actionConfig: { maxAttempts: 2 },
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
 * The one recipe whose single effect is a governed stage transition — the first
 * productive executor's target. Named so config validation and the UI can
 * special-case it without matching on a string literal in several places.
 */
export const GOVERNED_STAGE_ADVANCE_RECIPE_KEY = 'governed_stage_advance';

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
