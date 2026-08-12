import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import { LeadFlowAgentType } from '../enums/leadflow-agent-type.enum';
import type {
  LeadFlowAgentAvatarConfig,
  LeadFlowAgentBehaviorConfig,
  LeadFlowAgentChannelPolicy,
  LeadFlowAgentCrmPolicy,
  LeadFlowAgentHandoffPolicy,
  LeadFlowAgentPromptConfig,
} from '../types/leadflow-agent.types';

/**
 * A predefined agent template resolved by Business Mode. Presets are a pure
 * in-memory catalog (no DB table): the active Business Mode is read from
 * LeadFlow Settings and compatible presets are surfaced here. Presets never
 * expose a raw prompt; the prompt policy only references platform/business-mode
 * prompt templates, keeping raw editing behind developer permission.
 */
export interface LeadFlowAgentPresetCatalogItem {
  key: string;
  businessModeKey: LeadFlowBusinessMode;
  type: LeadFlowAgentType;
  name: string;
  description: string;
  isSystem: boolean;
  isProtected: boolean;
  isDeveloperOnly: boolean;
  behaviorConfig: LeadFlowAgentBehaviorConfig;
  promptConfig: LeadFlowAgentPromptConfig;
  handoffPolicy: LeadFlowAgentHandoffPolicy;
  crmPolicy: LeadFlowAgentCrmPolicy;
  channelPolicy: LeadFlowAgentChannelPolicy;
  avatarConfig: LeadFlowAgentAvatarConfig;
  allowedActions: string[];
  safetyRules: string[];
}

type Archetype = 'reception' | 'qualifier' | 'scheduler' | 'sales' | 'support';

const PLATFORM_SYSTEM_PROMPT_REF = 'lyra-leadflow-platform-system-v1';

const BASE_SAFETY_RULES = [
  'stay_within_business_scope',
  'never_invent_prices_or_availability',
  'escalate_sensitive_or_complaint_topics',
  'respect_client_business_hours',
];

const REGULATED_SAFETY_RULES: Partial<Record<LeadFlowBusinessMode, string[]>> =
  {
    [LeadFlowBusinessMode.ClinicsEsthetics]: [
      'never_diagnose',
      'no_promises_of_clinical_results',
    ],
    [LeadFlowBusinessMode.LegalAccounting]: [
      'no_legal_or_tax_advice',
      'only_initial_triage',
    ],
    [LeadFlowBusinessMode.FitnessWellness]: [
      'no_individual_training_or_diet_prescription',
    ],
  };

interface ArchetypeSpec {
  type: LeadFlowAgentType;
  label: string;
  describe: (modeLabel: string) => string;
  behavior: LeadFlowAgentBehaviorConfig;
  handoff: LeadFlowAgentHandoffPolicy;
  crm: LeadFlowAgentCrmPolicy;
  allowedActions: string[];
  avatar: LeadFlowAgentAvatarConfig;
}

const ARCHETYPES: Record<Archetype, ArchetypeSpec> = {
  reception: {
    type: LeadFlowAgentType.Reception,
    label: 'Recepção',
    describe: (mode) =>
      `Recebe, entende a intenção inicial e direciona contatos de ${mode}.`,
    behavior: {
      tone: 'acolhedor',
      language: 'pt-BR',
      proactivity: 'balanced',
      responseStyle: 'objetivo e cordial',
    },
    handoff: {
      triggers: ['lead_asks_for_human', 'complaint_or_sensitive_topic'],
      target: 'assigned_owner',
      slaMinutes: 15,
    },
    crm: { createLeads: true, updateStageOnQualified: false },
    allowedActions: ['send_message', 'capture_lead', 'request_handoff'],
    avatar: {
      preset: 'avatar-reception',
      outfit: 'office-blue',
      icon: 'headset',
    },
  },
  qualifier: {
    type: LeadFlowAgentType.Qualifier,
    label: 'Qualificação',
    describe: (mode) =>
      `Qualifica fit, urgência e contexto dos leads de ${mode} antes do próximo passo.`,
    behavior: {
      tone: 'consultivo',
      language: 'pt-BR',
      proactivity: 'high',
      responseStyle: 'perguntas objetivas de qualificação',
    },
    handoff: {
      triggers: ['low_confidence_answer', 'payment_or_contract_question'],
      target: 'assigned_owner',
      slaMinutes: 15,
    },
    crm: { createLeads: true, updateStageOnQualified: true },
    allowedActions: [
      'send_message',
      'capture_lead',
      'collect_qualification',
      'update_crm_stage',
      'request_handoff',
    ],
    avatar: {
      preset: 'avatar-qualifier',
      outfit: 'smart-casual',
      icon: 'clipboard-check',
    },
  },
  scheduler: {
    type: LeadFlowAgentType.Scheduler,
    label: 'Agendamento',
    describe: (mode) =>
      `Conduz interessados de ${mode} até um agendamento e confirma detalhes.`,
    behavior: {
      tone: 'objetivo',
      language: 'pt-BR',
      proactivity: 'high',
      responseStyle: 'foco em reduzir fricção para agendar',
    },
    handoff: {
      triggers: ['scheduling_conflict', 'lead_asks_for_human'],
      target: 'assigned_owner',
      slaMinutes: 10,
    },
    crm: { createLeads: true, updateStageOnQualified: true },
    allowedActions: [
      'send_message',
      'capture_lead',
      'schedule_appointment',
      'update_crm_stage',
      'request_handoff',
    ],
    avatar: {
      preset: 'avatar-scheduler',
      outfit: 'office-green',
      icon: 'calendar',
    },
  },
  sales: {
    type: LeadFlowAgentType.Sales,
    label: 'Consultor comercial',
    describe: (mode) =>
      `Apoia a venda consultiva de ${mode}, endereça objeções e conduz ao fechamento.`,
    behavior: {
      tone: 'consultivo',
      language: 'pt-BR',
      proactivity: 'high',
      responseStyle: 'persuasivo, sem pressão indevida',
    },
    handoff: {
      triggers: [
        'payment_or_contract_question',
        'negotiation_authority_needed',
        'lead_asks_for_human',
      ],
      target: 'assigned_owner',
      slaMinutes: 10,
    },
    crm: { createLeads: true, updateStageOnQualified: true },
    allowedActions: [
      'send_message',
      'capture_lead',
      'collect_qualification',
      'update_crm_stage',
      'request_handoff',
    ],
    avatar: { preset: 'avatar-sales', outfit: 'business', icon: 'handshake' },
  },
  support: {
    type: LeadFlowAgentType.Support,
    label: 'Atendimento',
    describe: (mode) =>
      `Responde dúvidas frequentes de ${mode} e resolve pedidos simples de atendimento.`,
    behavior: {
      tone: 'acolhedor',
      language: 'pt-BR',
      proactivity: 'balanced',
      responseStyle: 'claro e resolutivo',
    },
    handoff: {
      triggers: ['complaint_or_sensitive_topic', 'issue_out_of_scope'],
      target: 'assigned_owner',
      slaMinutes: 20,
    },
    crm: { createLeads: false, updateStageOnQualified: false },
    allowedActions: ['send_message', 'request_handoff'],
    avatar: {
      preset: 'avatar-support',
      outfit: 'office-neutral',
      icon: 'life-buoy',
    },
  },
};

const MODE_LABELS: Record<LeadFlowBusinessMode, string> = {
  [LeadFlowBusinessMode.AgencyServices]: 'agências e serviços profissionais',
  [LeadFlowBusinessMode.LocalServices]: 'serviços locais',
  [LeadFlowBusinessMode.ClinicsEsthetics]: 'clínicas e estética',
  [LeadFlowBusinessMode.RestaurantsFood]: 'restaurantes e alimentação',
  [LeadFlowBusinessMode.RealEstate]: 'imobiliário',
  [LeadFlowBusinessMode.EducationCourses]: 'educação e cursos',
  [LeadFlowBusinessMode.Automotive]: 'automotivo',
  [LeadFlowBusinessMode.RetailStore]: 'loja física e varejo',
  [LeadFlowBusinessMode.EcommerceLight]: 'e-commerce',
  [LeadFlowBusinessMode.EventsTourism]: 'eventos e turismo',
  [LeadFlowBusinessMode.LegalAccounting]: 'jurídico e contabilidade',
  [LeadFlowBusinessMode.FitnessWellness]: 'fitness e bem-estar',
};

const MODE_ARCHETYPES: Record<LeadFlowBusinessMode, Archetype[]> = {
  [LeadFlowBusinessMode.AgencyServices]: ['reception', 'qualifier', 'sales'],
  [LeadFlowBusinessMode.LocalServices]: ['reception', 'qualifier', 'scheduler'],
  [LeadFlowBusinessMode.ClinicsEsthetics]: [
    'reception',
    'qualifier',
    'scheduler',
  ],
  [LeadFlowBusinessMode.RestaurantsFood]: ['reception', 'scheduler', 'support'],
  [LeadFlowBusinessMode.RealEstate]: ['reception', 'qualifier', 'scheduler'],
  [LeadFlowBusinessMode.EducationCourses]: ['reception', 'qualifier', 'sales'],
  [LeadFlowBusinessMode.Automotive]: ['reception', 'qualifier', 'sales'],
  [LeadFlowBusinessMode.RetailStore]: ['reception', 'sales', 'support'],
  [LeadFlowBusinessMode.EcommerceLight]: ['reception', 'sales', 'support'],
  [LeadFlowBusinessMode.EventsTourism]: ['reception', 'qualifier', 'sales'],
  [LeadFlowBusinessMode.LegalAccounting]: [
    'reception',
    'qualifier',
    'scheduler',
  ],
  [LeadFlowBusinessMode.FitnessWellness]: [
    'reception',
    'qualifier',
    'scheduler',
  ],
};

function buildPreset(
  mode: LeadFlowBusinessMode,
  archetype: Archetype,
): LeadFlowAgentPresetCatalogItem {
  const spec = ARCHETYPES[archetype];
  const modeLabel = MODE_LABELS[mode];

  const promptConfig: LeadFlowAgentPromptConfig = {
    platformSystemPromptRef: PLATFORM_SYSTEM_PROMPT_REF,
    businessModePromptRef: `leadflow-business-mode-${mode}-v1`,
    clientPromptConfigRef: 'settings',
    variables: [
      'businessName',
      'businessSummary',
      'mainOffers',
      'businessHours',
      'handoffRules',
      'tone',
    ],
  };

  return {
    key: `${mode}.${archetype}`,
    businessModeKey: mode,
    type: spec.type,
    name: spec.label,
    description: spec.describe(modeLabel),
    isSystem: true,
    isProtected: archetype === 'reception',
    isDeveloperOnly: false,
    behaviorConfig: { ...spec.behavior },
    promptConfig,
    handoffPolicy: {
      ...spec.handoff,
      triggers: [...(spec.handoff.triggers ?? [])],
    },
    crmPolicy: { ...spec.crm },
    channelPolicy: { allowedChannels: [], defaultChannel: null },
    avatarConfig: { ...spec.avatar },
    allowedActions: [...spec.allowedActions],
    safetyRules: [
      ...BASE_SAFETY_RULES,
      ...(REGULATED_SAFETY_RULES[mode] ?? []),
    ],
  };
}

export const LEADFLOW_AGENT_PRESETS: LeadFlowAgentPresetCatalogItem[] =
  Object.entries(MODE_ARCHETYPES).flatMap(([mode, archetypes]) =>
    archetypes.map((archetype) =>
      buildPreset(mode as LeadFlowBusinessMode, archetype),
    ),
  );

const OFFICIAL_BUSINESS_MODES = new Set<string>(
  Object.values(LeadFlowBusinessMode),
);

/**
 * A Business Mode is "custom" when it is not one of the official seeded modes.
 * Custom modes only allow custom agents and gate advanced editing behind
 * developer permission.
 */
export function isCustomBusinessMode(businessModeKey: string): boolean {
  return !OFFICIAL_BUSINESS_MODES.has(businessModeKey);
}

export function getPresetsForBusinessMode(
  businessModeKey: string,
): LeadFlowAgentPresetCatalogItem[] {
  return LEADFLOW_AGENT_PRESETS.filter(
    (preset) => preset.businessModeKey === businessModeKey,
  );
}

/**
 * Handoff target/SLA defaults per agent type, as seeded by the preset
 * catalog (constant across Business Modes). This is the only "global"
 * source of truth for these two fields today — there is no per-tenant
 * override table for them.
 */
export function getHandoffDefaultsByType(): Record<
  LeadFlowAgentType,
  { target: string; slaMinutes: number }
> {
  const result = {} as Record<
    LeadFlowAgentType,
    { target: string; slaMinutes: number }
  >;
  for (const type of Object.values(LeadFlowAgentType)) {
    const policy = getHandoffPolicyDefaultsForType(type);
    result[type] = {
      target: policy.target ?? 'assigned_owner',
      slaMinutes: policy.slaMinutes ?? 15,
    };
  }
  return result;
}

const FALLBACK_HANDOFF_POLICY: LeadFlowAgentHandoffPolicy = {
  triggers: [
    'lead_asks_for_human',
    'low_confidence_answer',
    'complaint_or_sensitive_topic',
  ],
  target: 'assigned_owner',
  slaMinutes: 15,
};

/**
 * Configuração operacional de handoff administrada pelo backend para cada
 * papel. Agentes custom/concierge usam um conjunto seguro e abrangente; os
 * demais reutilizam o mesmo arquétipo que alimenta os presets.
 */
export function getHandoffPolicyDefaultsForType(
  type: LeadFlowAgentType,
): LeadFlowAgentHandoffPolicy {
  const policy =
    Object.values(ARCHETYPES).find((item) => item.type === type)?.handoff ??
    FALLBACK_HANDOFF_POLICY;

  return {
    ...policy,
    triggers: [...(policy.triggers ?? [])],
  };
}

/**
 * Completa configurações legadas sem sobrescrever extensões operacionais já
 * persistidas, como responsáveis nominais ou transferência de oportunidade.
 */
export function resolveHandoffPolicyForType(
  type: LeadFlowAgentType,
  policy: LeadFlowAgentHandoffPolicy | null | undefined,
): LeadFlowAgentHandoffPolicy {
  const defaults = getHandoffPolicyDefaultsForType(type);
  return {
    ...defaults,
    ...(policy ?? {}),
    triggers: Array.isArray(policy?.triggers)
      ? [...policy.triggers]
      : [...(defaults.triggers ?? [])],
  };
}

export function getPresetByKey(
  presetKey: string,
): LeadFlowAgentPresetCatalogItem | undefined {
  return LEADFLOW_AGENT_PRESETS.find((preset) => preset.key === presetKey);
}

/**
 * As ações que um tipo de agente pode executar, segundo o arquétipo do
 * catálogo. É o que muda quando um operador troca o tipo de um agente já
 * provisionado: o resto (nome, avatar, tom, canais) é escolha dele e é
 * preservado, mas as ações permitidas têm de acompanhar o novo papel — senão
 * um agente virado "Vendas" continuaria com as permissões de "Recepção".
 *
 * `custom` não tem arquétipo: fica com o mínimo seguro, o mesmo que o
 * provisionamento customizado aplica.
 */
export function getAllowedActionsForType(type: LeadFlowAgentType): string[] {
  const spec = Object.values(ARCHETYPES).find((item) => item.type === type);
  return spec ? [...spec.allowedActions] : ['send_message', 'request_handoff'];
}
