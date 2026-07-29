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
  | 'followup_step[]';

/**
 * Which surface a field belongs to. Consumed by the configuration UI so the
 * essential form stays short and technical fields stay out of it. Phase 1 only
 * declares the contract; it does not build the progressive-disclosure UI.
 */
export type LeadFlowAutomationFieldSurface =
  | 'essential'
  | 'advanced'
  | 'developer';

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
  },
  'trigger.stageRef': {
    key: 'stageRef',
    type: 'string',
    label: 'Restringir a uma etapa',
    surface: 'advanced',
    nullable: true,
    maxLength: 64,
  },

  // ------------------------------------------------------------- conditions
  'conditions.businessHoursOnly': {
    key: 'businessHoursOnly',
    type: 'boolean',
    label: 'Agir somente em horário comercial',
    surface: 'advanced',
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
  'conditions.ruleField': {
    key: 'ruleField',
    type: 'string',
    label: 'Campo da oportunidade',
    surface: 'essential',
    required: true,
    maxLength: 80,
  },
  'conditions.ruleOperator': {
    key: 'ruleOperator',
    type: 'enum',
    label: 'Operador',
    surface: 'essential',
    required: true,
    values: ['equals', 'not_equals', 'contains', 'is_present'],
  },
  'conditions.ruleValue': {
    key: 'ruleValue',
    type: 'string',
    label: 'Valor esperado',
    surface: 'essential',
    nullable: true,
    maxLength: 180,
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
    label: 'Quem será avisado',
    surface: 'essential',
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
  'actions.specificRecipientUserRefs': {
    key: 'specificRecipientUserRefs',
    type: 'string[]',
    label: 'Usuários específicos',
    surface: 'essential',
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
  'actions.distributionStrategy': {
    key: 'distributionStrategy',
    type: 'string',
    label: 'Regra de distribuição',
    surface: 'essential',
    required: true,
    maxLength: 20,
    values: ['least_volume', 'round_robin', 'by_channel'],
  },
  'actions.addTags': {
    key: 'addTags',
    type: 'string[]',
    label: 'Tags a aplicar',
    surface: 'essential',
    required: true,
    maxItems: 20,
    maxLength: 60,
  },
  'actions.requireHumanApproval': {
    key: 'requireHumanApproval',
    type: 'boolean',
    label: 'Exigir aprovação humana',
    surface: 'advanced',
  },

  // ---------------------------------------------------------------- message
  'message.channel': {
    key: 'channel',
    type: 'string',
    label: 'Canal de envio',
    surface: 'essential',
    nullable: true,
    maxLength: 64,
  },
  'message.templateRef': {
    key: 'templateRef',
    type: 'string',
    label: 'Modelo de mensagem',
    surface: 'advanced',
    nullable: true,
    maxLength: 64,
  },
  'message.templateLanguage': {
    key: 'templateLanguage',
    type: 'string',
    label: 'Idioma do modelo',
    surface: 'advanced',
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
  'crmPolicy.moveStageOnComplete': {
    key: 'moveStageOnComplete',
    type: 'string',
    label: 'Etapa ao concluir',
    surface: 'advanced',
    nullable: true,
    maxLength: 64,
  },
  'crmPolicy.moveStageReasonCode': {
    key: 'moveStageReasonCode',
    type: 'string',
    label: 'Motivo governado da mudança de etapa',
    surface: 'advanced',
    nullable: true,
    maxLength: 120,
  },
  'crmPolicy.transferToPipelineRef': {
    key: 'transferToPipelineRef',
    type: 'string',
    label: 'Pipeline de destino da transferência',
    surface: 'advanced',
    nullable: true,
    maxLength: 64,
  },
  'crmPolicy.transferToStageRef': {
    key: 'transferToStageRef',
    type: 'string',
    label: 'Etapa de destino da transferência',
    surface: 'advanced',
    nullable: true,
    maxLength: 64,
  },
  'crmPolicy.transferReasonCode': {
    key: 'transferReasonCode',
    type: 'string',
    label: 'Motivo governado da transferência',
    surface: 'advanced',
    nullable: true,
    maxLength: 120,
  },
  'crmPolicy.copyToPipelineRef': {
    key: 'copyToPipelineRef',
    type: 'string',
    label: 'Pipeline da nova negociação relacionada',
    surface: 'advanced',
    nullable: true,
    maxLength: 64,
  },
  'crmPolicy.copyToStageRef': {
    key: 'copyToStageRef',
    type: 'string',
    label: 'Etapa da nova negociação relacionada',
    surface: 'advanced',
    nullable: true,
    maxLength: 64,
  },
  'crmPolicy.copyReasonCode': {
    key: 'copyReasonCode',
    type: 'string',
    label: 'Motivo governado da cópia',
    surface: 'advanced',
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
  },
  'schedulePolicy.timezone': {
    key: 'timezone',
    type: 'string',
    label: 'Fuso horário',
    surface: 'essential',
    nullable: true,
    maxLength: 64,
  },
  'schedulePolicy.dailyTime': {
    key: 'dailyTime',
    type: 'string',
    label: 'Horário do resumo',
    surface: 'essential',
    required: true,
    maxLength: 5,
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
 * declare. Anything else is rejected by the validator.
 */
export function getSectionSchema(
  recipe: LeadFlowAutomationRecipeCatalogItem,
  section: LeadFlowAutomationConfigSection,
): LeadFlowAutomationFieldSpec[] {
  const defaults = SECTION_DEFAULTS[section](recipe) ?? {};
  const specs: LeadFlowAutomationFieldSpec[] = [];

  for (const key of Object.keys(defaults)) {
    const spec = getFieldSpec(section, key);
    if (spec) {
      specs.push(spec);
    }
  }

  return specs;
}

export function buildConfigSchema(
  recipe: LeadFlowAutomationRecipeCatalogItem,
): LeadFlowAutomationConfigSchema {
  return {
    trigger: getSectionSchema(recipe, 'trigger'),
    conditions: getSectionSchema(recipe, 'conditions'),
    actions: getSectionSchema(recipe, 'actions'),
    message: getSectionSchema(recipe, 'message'),
    crmPolicy: getSectionSchema(recipe, 'crmPolicy'),
    schedulePolicy: getSectionSchema(recipe, 'schedulePolicy'),
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
