import type { LeadFlowAutomationRecipeCatalogItem } from './automation-recipes.catalog';

/**
 * Closed configuration schema for automation recipes.
 *
 * The schema is DERIVED from each recipe's own defaults rather than
 * hand-written per recipe. That guarantees three things at once:
 *
 *  - every value already persisted validates, because it originated as a
 *    default (no data migration needed to start enforcing the schema);
 *  - a key that no recipe declares is rejected, so the jsonb columns stop being
 *    an arbitrary write surface (fail-closed);
 *  - the catalog cannot drift from the schema, because there is only one source.
 *
 * Field metadata (type, bounds, label, surface) lives in one dictionary keyed by
 * `section.key`. A default whose key has no spec is a catalog bug and is caught
 * by `automation-config-schemas.catalog.spec.ts`.
 */

export type LeadFlowAutomationFieldType =
  | 'boolean'
  | 'number'
  | 'string'
  | 'string[]'
  | 'enum'
  | 'offset[]'
  | 'followup_step[]'
  | 'tag_rule[]'
  | 'business_hours';

/**
 * Which surface a field belongs to. Consumed by the configuration UI so the
 * essential form stays short and technical fields stay out of it. Phase 1 only
 * declares the contract; it does not build the progressive-disclosure UI.
 */
export type LeadFlowAutomationFieldSurface =
  | 'essential'
  | 'advanced'
  | 'developer';

/**
 * Who a field belongs to, which is a different axis from which surface it sits
 * on. A surface answers "how technical is this decision"; an audience answers
 * "whose decision is it at all".
 *
 * An agency-only field is not merely hidden from a client context: the schema
 * never declares it there, so the fail-closed validator rejects it on write for
 * the same reason the UI cannot draw it. One rule, two enforcement points.
 */
export type LeadFlowAutomationConfigAudience = 'agency' | 'client';

export interface LeadFlowAutomationFieldSpec {
  key: string;
  type: LeadFlowAutomationFieldType;
  label: string;
  surface: LeadFlowAutomationFieldSurface;
  /** Required fields drive readiness: missing ones block activation. */
  required?: boolean;
  nullable?: boolean;
  /** Structural field defined by the recipe; may not be changed by the operator. */
  readOnly?: boolean;
  /** A `null` instance value deliberately inherits the resolved default. */
  inheritable?: boolean;
  /** Restricts the field to one audience; absent means everyone sees it. */
  audience?: LeadFlowAutomationConfigAudience;
  min?: number;
  max?: number;
  maxLength?: number;
  maxItems?: number;
  values?: readonly string[];
}

export type LeadFlowAutomationConfigSection =
  | 'trigger'
  | 'conditions'
  | 'actions'
  | 'message'
  | 'crmPolicy'
  | 'schedulePolicy';

export const LEADFLOW_AUTOMATION_CONFIG_SECTIONS: readonly LeadFlowAutomationConfigSection[] =
  [
    'trigger',
    'conditions',
    'actions',
    'message',
    'crmPolicy',
    'schedulePolicy',
  ];

export type LeadFlowAutomationConfigSchema = Record<
  LeadFlowAutomationConfigSection,
  LeadFlowAutomationFieldSpec[]
>;

const HOURS_IN_A_YEAR = 8760;

/**
 * Central field dictionary. Keys are `${section}.${key}`.
 * Labels are business-facing on purpose — the UI must never surface the raw key.
 */
const FIELD_SPECS: Record<string, LeadFlowAutomationFieldSpec> = {
  // ---------------------------------------------------------------- trigger
  'trigger.type': {
    key: 'type',
    type: 'string',
    label: 'Evento que dispara',
    surface: 'developer',
    readOnly: true,
    maxLength: 80,
  },
  'trigger.delayHours': {
    key: 'delayHours',
    type: 'number',
    label: 'Tempo sem resposta antes de agir',
    surface: 'essential',
    required: true,
    min: 1,
    max: HOURS_IN_A_YEAR,
    inheritable: true,
  },
  'trigger.confirmationHoursBefore': {
    key: 'confirmationHoursBefore',
    type: 'number',
    label: 'Antecedência da confirmação (horas)',
    surface: 'essential',
    required: true,
    min: 0,
    max: HOURS_IN_A_YEAR,
  },
  'trigger.noShowGraceMinutes': {
    key: 'noShowGraceMinutes',
    type: 'number',
    label: 'Tolerância para não comparecimento (minutos)',
    surface: 'essential',
    required: true,
    min: 0,
    max: 24 * 60,
  },
  'trigger.idleHoursInStage': {
    key: 'idleHoursInStage',
    type: 'number',
    label: 'Tempo parado na etapa antes de agir',
    surface: 'essential',
    required: true,
    min: 1,
    max: HOURS_IN_A_YEAR,
  },
  'trigger.pipelineRef': {
    key: 'pipelineRef',
    type: 'string',
    label: 'Restringir a um funil',
    surface: 'advanced',
    nullable: true,
    maxLength: 64,
    inheritable: true,
  },
  'trigger.stageRef': {
    key: 'stageRef',
    type: 'string',
    label: 'Restringir a uma etapa',
    surface: 'advanced',
    nullable: true,
    maxLength: 64,
    inheritable: true,
  },

  // ------------------------------------------------------------- conditions
  'conditions.businessHoursOnly': {
    key: 'businessHoursOnly',
    type: 'boolean',
    label: 'Agir somente em horário comercial',
    surface: 'advanced',
    inheritable: true,
  },
  'conditions.requireExplicitConsent': {
    key: 'requireExplicitConsent',
    type: 'boolean',
    label: 'Exigir consentimento explícito',
    surface: 'advanced',
    inheritable: true,
  },
  'conditions.stopIfReplied': {
    key: 'stopIfReplied',
    type: 'boolean',
    label: 'Cancelar se o lead responder',
    surface: 'advanced',
  },
  'conditions.stopIfHandoff': {
    key: 'stopIfHandoff',
    type: 'boolean',
    label: 'Cancelar se houver transferência para humano',
    surface: 'advanced',
  },
  'conditions.minScore': {
    key: 'minScore',
    type: 'number',
    label: 'Pontuação mínima do lead',
    surface: 'essential',
    required: true,
    min: 0,
    max: 100,
  },
  'conditions.intents': {
    key: 'intents',
    type: 'string[]',
    label: 'Intenções que ativam',
    surface: 'essential',
    maxItems: 20,
    maxLength: 60,
  },
  'conditions.keywords': {
    key: 'keywords',
    type: 'string[]',
    label: 'Palavras-chave que ativam',
    surface: 'essential',
    maxItems: 20,
    maxLength: 60,
  },
  'conditions.requiredFields': {
    key: 'requiredFields',
    type: 'string[]',
    label: 'Campos obrigatórios a cobrar',
    surface: 'essential',
    required: true,
    maxItems: 20,
    maxLength: 60,
  },
  // One field, one operator and one value used to be three separate keys, which
  // could only ever describe a single rule — and a single rule is not how
  // tagging is used: an operator wants "veio do WhatsApp" and "é urgente" to
  // apply different tags. The rule is therefore one value, and the tags it
  // applies belong to it rather than to the automation.
  'conditions.tagRules': {
    key: 'tagRules',
    type: 'tag_rule[]',
    label: 'Regras de tag',
    surface: 'essential',
    required: true,
    maxItems: 10,
  },

  // ---------------------------------------------------------------- actions
  'actions.primaryAction': {
    key: 'primaryAction',
    type: 'string',
    label: 'Ação executada',
    surface: 'developer',
    readOnly: true,
    maxLength: 60,
  },
  'actions.maxAttempts': {
    key: 'maxAttempts',
    type: 'number',
    label: 'Máximo de tentativas',
    surface: 'essential',
    required: true,
    min: 1,
    max: 10,
    inheritable: true,
  },
  'actions.moveToStageRef': {
    key: 'moveToStageRef',
    type: 'string',
    label: 'Mover para a etapa',
    surface: 'advanced',
    nullable: true,
    maxLength: 64,
  },
  'actions.targetUserRef': {
    key: 'targetUserRef',
    type: 'string',
    label: 'Destinatário fixo (ID de usuário)',
    surface: 'developer',
    nullable: true,
    maxLength: 64,
  },
  'actions.notifyOpportunityOwner': {
    key: 'notifyOpportunityOwner',
    type: 'boolean',
    label: 'Avisar responsável pela oportunidade',
    surface: 'essential',
  },
  'actions.notifyPipelineOwner': {
    key: 'notifyPipelineOwner',
    type: 'boolean',
    label: 'Avisar responsável pelo pipeline',
    surface: 'essential',
  },
  'actions.notifyPipelineParticipants': {
    key: 'notifyPipelineParticipants',
    type: 'boolean',
    label: 'Avisar participantes do pipeline',
    surface: 'advanced',
  },
  // Internal user identifiers. As free text they can only be filled correctly by
  // someone who can read the database, so they stay on the developer surface
  // until there is a real people picker to choose from.
  'actions.specificRecipientUserRefs': {
    key: 'specificRecipientUserRefs',
    type: 'string[]',
    label: 'Usuários específicos (IDs)',
    surface: 'developer',
    maxItems: 20,
    maxLength: 64,
  },
  'actions.notificationChannels': {
    key: 'notificationChannels',
    type: 'string[]',
    label: 'Canais de notificação',
    surface: 'essential',
    required: true,
    maxItems: 4,
    maxLength: 32,
    values: ['in_app', 'push', 'platform_whatsapp', 'email'],
  },
  // Declared as `enum`, not `string`: the validator already refused anything
  // outside `values`, so a free-text box could only ever be filled wrong.
  'actions.distributionStrategy': {
    key: 'distributionStrategy',
    type: 'enum',
    label: 'Regra de distribuição',
    surface: 'essential',
    required: true,
    maxLength: 20,
    values: ['least_volume', 'round_robin', 'by_channel'],
  },
  'actions.requireHumanApproval': {
    key: 'requireHumanApproval',
    type: 'boolean',
    label: 'Exigir aprovação humana',
    surface: 'advanced',
  },
  // Publishing into the agency's own Team Chat is an agency decision about an
  // agency space. A client context has no channel to point at, so it does not
  // receive these two fields at all — not to read and not to write.
  'actions.deliverToTeamChat': {
    key: 'deliverToTeamChat',
    type: 'boolean',
    label: 'Publicar no Team Chat',
    surface: 'essential',
    audience: 'agency',
  },
  'actions.teamChatChannelId': {
    key: 'teamChatChannelId',
    type: 'string',
    label: 'Canal do Team Chat',
    surface: 'essential',
    nullable: true,
    maxLength: 64,
    audience: 'agency',
  },

  // ---------------------------------------------------------------- message
  // The set of channels a message can leave through is closed and known — the
  // same list the follow-up step policy validates against. Typing one is not a
  // decision the operator can get right by hand.
  'message.channel': {
    key: 'channel',
    type: 'enum',
    label: 'Canal de envio',
    surface: 'essential',
    nullable: true,
    maxLength: 64,
    inheritable: true,
    values: [
      'whatsapp',
      'email',
      'sms',
      'facebook_messenger',
      'instagram_direct',
      'webchat',
    ],
  },
  // Provider template plumbing: the follow-up panel already carries the approved
  // WhatsApp template per channel, and these two only matter to whoever wires a
  // provider account.
  'message.templateRef': {
    key: 'templateRef',
    type: 'string',
    label: 'Modelo de mensagem (provider)',
    surface: 'developer',
    nullable: true,
    maxLength: 64,
  },
  'message.templateLanguage': {
    key: 'templateLanguage',
    type: 'string',
    label: 'Idioma do modelo (provider)',
    surface: 'developer',
    nullable: true,
    maxLength: 35,
  },
  'message.baseMessage': {
    key: 'baseMessage',
    type: 'string',
    label: 'Orientação para a mensagem',
    surface: 'essential',
    maxLength: 2000,
  },
  'message.quickReplies': {
    key: 'quickReplies',
    type: 'string[]',
    label: 'Respostas rápidas oferecidas',
    surface: 'essential',
    maxItems: 10,
    maxLength: 60,
  },
  'message.followupSteps': {
    key: 'followupSteps',
    type: 'followup_step[]',
    label: 'Canais por passo do follow-up',
    surface: 'essential',
    required: true,
    maxItems: 7,
  },

  // -------------------------------------------------------------- crmPolicy
  //
  // Every recipe inherits the whole CRM policy block from the base defaults,
  // including keys for transferring and copying an opportunity — actions no
  // recipe in the catalog performs and no executor implements. Rather than
  // remove the keys (which would make every stored configuration fail the
  // fail-closed validator on its next save), they are demoted to the developer
  // surface: the contract is unchanged, the operator stops being asked about
  // effects that cannot happen.
  'crmPolicy.moveStageOnComplete': {
    key: 'moveStageOnComplete',
    type: 'string',
    label: 'Mover para a etapa ao concluir',
    surface: 'advanced',
    nullable: true,
    maxLength: 64,
  },
  'crmPolicy.moveStageReasonCode': {
    key: 'moveStageReasonCode',
    type: 'string',
    label: 'Motivo governado da mudança de etapa',
    surface: 'developer',
    nullable: true,
    maxLength: 120,
  },
  'crmPolicy.transferToPipelineRef': {
    key: 'transferToPipelineRef',
    type: 'string',
    label: 'Pipeline de destino da transferência',
    surface: 'developer',
    nullable: true,
    maxLength: 64,
  },
  'crmPolicy.transferToStageRef': {
    key: 'transferToStageRef',
    type: 'string',
    label: 'Etapa de destino da transferência',
    surface: 'developer',
    nullable: true,
    maxLength: 64,
  },
  'crmPolicy.transferReasonCode': {
    key: 'transferReasonCode',
    type: 'string',
    label: 'Motivo governado da transferência',
    surface: 'developer',
    nullable: true,
    maxLength: 120,
  },
  'crmPolicy.copyToPipelineRef': {
    key: 'copyToPipelineRef',
    type: 'string',
    label: 'Pipeline da nova negociação relacionada',
    surface: 'developer',
    nullable: true,
    maxLength: 64,
  },
  'crmPolicy.copyToStageRef': {
    key: 'copyToStageRef',
    type: 'string',
    label: 'Etapa da nova negociação relacionada',
    surface: 'developer',
    nullable: true,
    maxLength: 64,
  },
  'crmPolicy.copyReasonCode': {
    key: 'copyReasonCode',
    type: 'string',
    label: 'Motivo governado da cópia',
    surface: 'developer',
    nullable: true,
    maxLength: 120,
  },
  'crmPolicy.updateScore': {
    key: 'updateScore',
    type: 'boolean',
    label: 'Atualizar pontuação do lead',
    surface: 'advanced',
  },
  'crmPolicy.addTags': {
    key: 'addTags',
    type: 'string[]',
    label: 'Tags a aplicar na oportunidade',
    surface: 'advanced',
    maxItems: 20,
    maxLength: 60,
  },
  'crmPolicy.appendNote': {
    key: 'appendNote',
    type: 'boolean',
    label: 'Registrar nota no histórico',
    surface: 'advanced',
  },

  // --------------------------------------------------------- schedulePolicy
  'schedulePolicy.respectBusinessHours': {
    key: 'respectBusinessHours',
    type: 'boolean',
    label: 'Respeitar horário comercial',
    surface: 'advanced',
    inheritable: true,
  },
  // The time zone is a property of the business, decided once in the global
  // automation settings. Asking it again per automation invites two answers to
  // the same question; the per-instance override survives as a technical escape
  // hatch on the developer surface.
  'schedulePolicy.timezone': {
    key: 'timezone',
    type: 'string',
    label: 'Fuso horário (sobrescreve o global)',
    surface: 'developer',
    nullable: true,
    maxLength: 64,
    inheritable: true,
  },
  // Cadence is three fields because it is three questions, and two of them only
  // exist inside one answer: a weekly summary needs a weekday, a monthly one a
  // day of the month, and a daily one neither. Keeping the unused one stored
  // (rather than cleared on every switch) means the operator gets their previous
  // choice back when they switch cadence again.
  'schedulePolicy.frequency': {
    key: 'frequency',
    type: 'enum',
    label: 'Frequência',
    surface: 'essential',
    required: true,
    maxLength: 10,
    values: ['daily', 'weekly', 'monthly'],
  },
  'schedulePolicy.dailyTime': {
    key: 'dailyTime',
    type: 'string',
    label: 'Horário do envio',
    surface: 'essential',
    required: true,
    maxLength: 5,
  },
  'schedulePolicy.weekday': {
    key: 'weekday',
    type: 'enum',
    label: 'Dia da semana',
    surface: 'essential',
    nullable: true,
    maxLength: 10,
    values: [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ],
  },
  'schedulePolicy.dayOfMonth': {
    key: 'dayOfMonth',
    type: 'number',
    label: 'Dia do mês',
    surface: 'essential',
    nullable: true,
    min: 1,
    max: 31,
  },
  'schedulePolicy.responseWindowHours': {
    key: 'responseWindowHours',
    type: 'number',
    label: 'Prazo para responder (horas)',
    surface: 'advanced',
    required: true,
    min: 1,
    max: 720,
  },
  'schedulePolicy.offsets': {
    key: 'offsets',
    type: 'offset[]',
    label: 'Antecedências dos lembretes',
    surface: 'advanced',
    maxItems: 10,
  },
  // The one automation whose whole subject is the clock needs to be able to
  // disagree with the workspace: the hours the Inbox considers open are the
  // hours a human is expected to be there, and an operator may want the
  // out-of-hours reply to start earlier than that. Null inherits the workspace
  // schedule, which is what every instance does until someone says otherwise.
  'schedulePolicy.businessHours': {
    key: 'businessHours',
    type: 'business_hours',
    label: 'Horário de atendimento desta automação',
    surface: 'essential',
    nullable: true,
  },
  'schedulePolicy.cooldownHours': {
    key: 'cooldownHours',
    type: 'number',
    label: 'Intervalo mínimo entre execuções',
    surface: 'advanced',
    required: true,
    min: 0,
    max: HOURS_IN_A_YEAR,
  },
};

export function getFieldSpec(
  section: LeadFlowAutomationConfigSection,
  key: string,
): LeadFlowAutomationFieldSpec | undefined {
  return FIELD_SPECS[`${section}.${key}`];
}

/** The field matrix shared by provisioning, validation, and the editor. */
export function isInheritableConfigField(
  section: LeadFlowAutomationConfigSection,
  key: string,
): boolean {
  return getFieldSpec(section, key)?.inheritable === true;
}

const SECTION_DEFAULTS: Record<
  LeadFlowAutomationConfigSection,
  (recipe: LeadFlowAutomationRecipeCatalogItem) => Record<string, unknown>
> = {
  trigger: (recipe) => recipe.defaultTriggerConfig,
  conditions: (recipe) => recipe.defaultConditionConfig,
  actions: (recipe) => recipe.defaultActionConfig,
  message: (recipe) => recipe.defaultMessageConfig,
  crmPolicy: (recipe) => recipe.defaultCrmPolicy,
  schedulePolicy: (recipe) => recipe.defaultSchedulePolicy,
};

/**
 * Allowed keys for one section of one recipe: exactly the keys its defaults
 * declare, minus the ones addressed to another audience. Anything else is
 * rejected by the validator.
 */
export function getSectionSchema(
  recipe: LeadFlowAutomationRecipeCatalogItem,
  section: LeadFlowAutomationConfigSection,
  audience: LeadFlowAutomationConfigAudience = 'agency',
): LeadFlowAutomationFieldSpec[] {
  const defaults = SECTION_DEFAULTS[section](recipe) ?? {};
  const specs: LeadFlowAutomationFieldSpec[] = [];

  for (const key of Object.keys(defaults)) {
    const spec = getFieldSpec(section, key);
    if (spec && (!spec.audience || spec.audience === audience)) {
      specs.push(spec);
    }
  }

  return specs;
}

export function buildConfigSchema(
  recipe: LeadFlowAutomationRecipeCatalogItem,
  audience: LeadFlowAutomationConfigAudience = 'agency',
): LeadFlowAutomationConfigSchema {
  return {
    trigger: getSectionSchema(recipe, 'trigger', audience),
    conditions: getSectionSchema(recipe, 'conditions', audience),
    actions: getSectionSchema(recipe, 'actions', audience),
    message: getSectionSchema(recipe, 'message', audience),
    crmPolicy: getSectionSchema(recipe, 'crmPolicy', audience),
    schedulePolicy: getSectionSchema(recipe, 'schedulePolicy', audience),
  };
}

/**
 * Keys declared by a recipe's defaults that have no entry in the dictionary.
 * Always empty in a healthy catalog; asserted by the catalog spec.
 */
export function findUnspecifiedDefaultKeys(
  recipe: LeadFlowAutomationRecipeCatalogItem,
): string[] {
  const orphans: string[] = [];

  for (const section of LEADFLOW_AUTOMATION_CONFIG_SECTIONS) {
    const defaults = SECTION_DEFAULTS[section](recipe) ?? {};
    for (const key of Object.keys(defaults)) {
      if (!getFieldSpec(section, key)) {
        orphans.push(`${section}.${key}`);
      }
    }
  }

  return orphans;
}
