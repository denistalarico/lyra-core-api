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
    schedulePolicy: { cooldownHours: 24 },
  },
  {
    key: 'followup_by_crm_stage',
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
  },
  {
    key: 'appointment_reminder',
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
    primaryAction: 'send_message',
    whenLabel: 'Antes do horário agendado (24h, 2h e 30min).',
    limitsLabel: 'Envia apenas dentro da janela do compromisso.',
    schedulePolicy: {
      offsets: [
        { label: '24h antes', minutesBefore: 24 * 60 },
        { label: '2h antes', minutesBefore: 2 * 60 },
        { label: '30min antes', minutesBefore: 30 },
      ],
    },
  },
  {
    key: 'appointment_confirmation',
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
    whenLabel: 'No prazo de confirmação configurado antes do compromisso.',
    limitsLabel:
      'Ações distintas para confirmar, cancelar ou não responder; sem insistência excessiva.',
    messageConfig: { quickReplies: ['Confirmar', 'Reagendar', 'Cancelar'] },
  },
  {
    key: 'appointment_no_show_recovery',
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
    whenLabel: 'Quando o lead não comparece ao compromisso.',
    limitsLabel:
      'Limite de tentativas de reagendamento e notificação ao responsável.',
    actionConfig: { maxAttempts: 2, moveToStageRef: null },
    crmPolicy: { moveStageOnComplete: null },
  },
  {
    key: 'hot_lead_notification',
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
    actionConfig: { targetUserRef: null, requireHumanApproval: true },
  },
  {
    key: 'automatic_handoff',
    requiredDependencies: [LeadFlowAutomationDependency.EventFanOut],
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
    whenLabel: 'Após o fechamento, agenda concluída ou handoff resolvido.',
    limitsLabel: 'Um envio por evento concluído; respeita cooldown.',
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
    schedulePolicy: { cooldownHours: 720 },
  },
  {
    key: 'daily_opportunity_summary',
    requiredDependencies: [
      LeadFlowAutomationDependency.AnalyticsBackend,
      LeadFlowAutomationDependency.SchedulerRuntime,
    ],
    name: 'Resumo diário de oportunidades',
    description:
      'Envia ao responsável um resumo das oportunidades do dia (placeholder de resumo).',
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
  },
  {
    key: 'lead_distribution',
    requiredDependencies: [
      LeadFlowAutomationDependency.EventFanOut,
      LeadFlowAutomationDependency.OwnershipCommand,
    ],
    name: 'Distribuição de leads',
    description:
      'Distribui novas oportunidades entre responsáveis conforme a regra configurada.',
    category: LeadFlowAutomationCategory.Routing,
    tier: 'optional',
    businessModeKeys: [RealEstate, AgencyServices, Automotive, LocalServices],
    trigger: 'opportunity.created',
    primaryAction: 'notify_user',
    whenLabel: 'Quando uma nova oportunidade é criada.',
    limitsLabel: 'Distribuição interna; não envia mensagem ao lead.',
    conditionConfig: { businessHoursOnly: false, stopIfReplied: false },
    actionConfig: { targetUserRef: null },
  },
  {
    key: 'automatic_tagging',
    requiredDependencies: [LeadFlowAutomationDependency.EventFanOut],
    name: 'Tag automática',
    description:
      'Aplica tags à oportunidade com base em critérios simples da conversa.',
    category: LeadFlowAutomationCategory.Tagging,
    tier: 'optional',
    trigger: 'conversation.created',
    primaryAction: 'add_tag',
    whenLabel: 'Quando uma nova conversa é iniciada.',
    limitsLabel: 'Apenas organização interna; sem envio de mensagem.',
    conditionConfig: {
      businessHoursOnly: false,
      stopIfReplied: false,
      keywords: [],
    },
    actionConfig: { primaryAction: 'add_tag', addTags: [] },
    crmPolicy: { addTags: [] },
  },
  {
    key: 'nps_feedback',
    requiredDependencies: [
      LeadFlowAutomationDependency.AgendaDomain,
      LeadFlowAutomationDependency.SchedulerRuntime,
      LeadFlowAutomationDependency.MessageGeneration,
    ],
    name: 'Pós-venda / NPS',
    description: 'Pede feedback/NPS após a conclusão do atendimento.',
    category: LeadFlowAutomationCategory.Feedback,
    tier: 'optional',
    trigger: 'appointment.completed',
    primaryAction: 'send_message',
    whenLabel: 'Após o atendimento ou venda concluída.',
    limitsLabel: 'Um pedido por evento; respeita opt-out.',
    messageConfig: { quickReplies: ['0-6', '7-8', '9-10'] },
    schedulePolicy: { cooldownHours: 168 },
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
  return LEADFLOW_AUTOMATION_RECIPES.find((recipe) => recipe.key === recipeKey);
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
