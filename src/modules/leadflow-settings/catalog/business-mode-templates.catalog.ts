import { LeadFlowBusinessMode } from '../enums/leadflow-business-mode.enum';
import { getContextDefaults } from './business-mode-context-defaults.catalog';
import { LeadFlowSettingsStatus } from '../enums/leadflow-settings-status.enum';
import { LeadFlowJsonObject } from '../types/leadflow-settings.types';
import type {
  ConversationPlaybook,
  ConversationQualificationFieldRule,
} from '../types/conversation-playbook.types';

export type LeadFlowBusinessModeTemplateCatalogItem = {
  key: LeadFlowBusinessMode;
  name: string;
  description: string;
  category: string;
  version: number;
  status: LeadFlowSettingsStatus;
  isOfficial: boolean;
  isSystem: boolean;
  isDeveloperOnly: boolean;
  pipelineTemplate: LeadFlowJsonObject;
  conversionGoals: LeadFlowJsonObject;
  qualificationFields: LeadFlowJsonObject[];
  agentPromptTemplate: LeadFlowJsonObject;
  clientPromptSchema: LeadFlowJsonObject;
  inboxRules: LeadFlowJsonObject;
  handoffRules: LeadFlowJsonObject;
  recommendedApps: LeadFlowJsonObject[];
  supportedIntegrations: LeadFlowJsonObject;
  developerOverridesSchema: LeadFlowJsonObject;
  /**
   * Company-context values the mode ships with. Seeded into the draft at
   * creation, so the operator inherits a working agent instead of a blank form.
   */
  contextDefaults: LeadFlowJsonObject;
  metadata: LeadFlowJsonObject;
};

/**
 * Every field the agent context can hold, with the two properties that decide
 * how much work the end user is asked to do:
 *
 * - `source` — who fills it. `default` comes from the Business Mode catalog and
 *   is already in the draft before anyone opens the screen; `briefing` is
 *   extracted from the customer's own material and only needs confirming;
 *   `user` is the short list nobody else can answer.
 * - `visibility` — `basic` is the handful worth showing to a non-technical
 *   owner; `advanced` only surfaces under Developer Mode.
 *
 * The web app renders straight from this list, so re-classifying a field is a
 * catalog change here and not a frontend release.
 */
const clientPromptSchema = {
  version: 2,
  fields: [
    // --- basic: extracted from the customer's material, user confirms -------
    {
      key: 'businessName',
      label: 'Nome do negócio',
      type: 'text',
      required: true,
      visibility: 'basic',
      source: 'briefing',
      contextPath: 'identity.publicName',
    },
    {
      key: 'businessSummary',
      label: 'Resumo do negócio',
      type: 'textarea',
      required: true,
      visibility: 'basic',
      source: 'briefing',
      contextPath: 'identity.summary',
    },
    {
      key: 'mainOffers',
      label: 'Principais produtos ou serviços',
      type: 'textarea',
      required: true,
      visibility: 'basic',
      source: 'briefing',
      contextPath: 'offers',
    },
    {
      key: 'businessHours',
      label: 'Horário de atendimento',
      type: 'textarea',
      required: false,
      visibility: 'basic',
      source: 'briefing',
      contextPath: 'service.businessHours',
    },
    {
      key: 'regionsServed',
      label: 'Regiões atendidas',
      type: 'text',
      required: false,
      visibility: 'basic',
      source: 'briefing',
      contextPath: 'identity.regionsServed',
    },

    // --- basic: the only questions the product genuinely has to ask ---------
    {
      key: 'conversionGoal',
      label: 'O que conta como sucesso',
      type: 'text',
      required: false,
      visibility: 'basic',
      source: 'user',
      contextPath: 'qualification.conversionGoal',
    },
    {
      key: 'preferredCta',
      label: 'Convite usado na conversa',
      type: 'text',
      required: false,
      visibility: 'basic',
      source: 'user',
      contextPath: 'qualification.preferredCta',
    },
    {
      key: 'handoffRules',
      label: 'Quando chamar uma pessoa do time',
      type: 'textarea',
      required: false,
      visibility: 'basic',
      source: 'user',
      contextPath: 'service.handoffRules',
    },

    // --- advanced: seeded by the Business Mode, never asked -----------------
    {
      key: 'tone',
      label: 'Tom de voz',
      type: 'select',
      required: false,
      visibility: 'advanced',
      source: 'default',
      contextPath: 'legacyTone',
      options: [
        'profissional',
        'acolhedor',
        'consultivo',
        'objetivo',
        'descontraido',
      ],
    },
    {
      key: 'targetAudience',
      label: 'Público-alvo',
      type: 'textarea',
      required: false,
      visibility: 'advanced',
      source: 'default',
      contextPath: 'identity.targetAudience',
    },
    {
      key: 'languages',
      label: 'Idiomas',
      type: 'text',
      required: false,
      visibility: 'advanced',
      source: 'default',
      contextPath: 'identity.languages',
    },
    {
      key: 'timezone',
      label: 'Fuso horário',
      type: 'text',
      required: false,
      visibility: 'advanced',
      source: 'default',
      contextPath: 'identity.timezone',
    },
    {
      key: 'serviceLevel',
      label: 'Prazo de resposta',
      type: 'textarea',
      required: false,
      visibility: 'advanced',
      source: 'default',
      contextPath: 'service.serviceLevel',
    },
    {
      key: 'emergencyRules',
      label: 'Urgência e emergência',
      type: 'textarea',
      required: false,
      visibility: 'advanced',
      source: 'default',
      contextPath: 'service.emergencyRules',
    },
    {
      key: 'unsupportedRequests',
      label: 'O que o agente não resolve',
      type: 'textarea',
      required: false,
      visibility: 'advanced',
      source: 'default',
      contextPath: 'service.unsupportedRequests',
    },
    {
      key: 'qualifiedCriteria',
      label: 'Critérios de lead qualificado',
      type: 'textarea',
      required: false,
      visibility: 'advanced',
      source: 'default',
      contextPath: 'qualification.qualifiedCriteria',
    },
    {
      key: 'disqualificationCriteria',
      label: 'Desqualificação / não-lead',
      type: 'textarea',
      required: false,
      visibility: 'advanced',
      source: 'default',
      contextPath: 'qualification.disqualificationCriteria',
    },
    {
      key: 'urgencySignals',
      label: 'Sinais de urgência',
      type: 'textarea',
      required: false,
      visibility: 'advanced',
      source: 'default',
      contextPath: 'qualification.urgencySignals',
    },

    // --- advanced: refinements the customer's material may already carry ----
    {
      key: 'legalName',
      label: 'Razão social',
      type: 'text',
      required: false,
      visibility: 'advanced',
      source: 'briefing',
      contextPath: 'identity.legalName',
    },
    {
      key: 'valueProposition',
      label: 'Proposta de valor',
      type: 'textarea',
      required: false,
      visibility: 'advanced',
      source: 'briefing',
      contextPath: 'identity.valueProposition',
    },
    {
      key: 'differentiators',
      label: 'Diferenciais',
      type: 'textarea',
      required: false,
      visibility: 'advanced',
      source: 'briefing',
      contextPath: 'identity.differentiators',
    },
    {
      key: 'policies',
      label: 'Pagamento, entrega, cancelamento e garantia',
      type: 'textarea',
      required: false,
      visibility: 'advanced',
      source: 'briefing',
      contextPath: 'policies',
    },
    {
      key: 'faq',
      label: 'Perguntas frequentes',
      type: 'textarea',
      required: false,
      visibility: 'advanced',
      source: 'briefing',
      contextPath: 'faq',
    },
    {
      key: 'links',
      label: 'Links públicos',
      type: 'textarea',
      required: false,
      visibility: 'advanced',
      source: 'briefing',
      contextPath: 'links',
    },

    // --- advanced: fine-tuning for operators who want it --------------------
    {
      key: 'essentialQuestions',
      label: 'Perguntas essenciais',
      type: 'textarea',
      required: false,
      visibility: 'advanced',
      source: 'user',
      contextPath: 'qualification.essentialQuestions',
    },
    {
      key: 'priorityServices',
      label: 'Serviços prioritários',
      type: 'textarea',
      required: false,
      visibility: 'advanced',
      source: 'user',
      contextPath: 'qualification.priorityServices',
    },
  ],
};

const developerOverridesSchema = {
  allow: [
    'rawSystemPrompt',
    'rawUserPrompt',
    'pipelineTemplate',
    'inboxRules',
    'handoffRules',
    'qualificationFields',
  ],
  requireConfirmation: true,
  requiredPermission: 'leadflow.settings.danger_zone.manage.owner_only',
};

const defaultInboxRules = {
  routing: {
    defaultQueue: 'leadflow',
    prioritySignals: ['price_request', 'booking_intent', 'handoff_requested'],
  },
  sla: {
    firstResponseMinutes: 5,
    humanHandoffMinutes: 15,
  },
  tags: ['leadflow', 'new_lead'],
};

const defaultHandoffRules = {
  triggers: [
    'lead_asks_for_human',
    'complaint_or_sensitive_topic',
    'payment_or_contract_question',
    'low_confidence_answer',
  ],
  target: 'assigned_owner',
};

function stages(names: string[]) {
  return {
    stages: names.map((name, index) => ({
      key: name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, ''),
      name,
      position: index + 1,
    })),
  };
}

function qualificationFields(fields: string[]): LeadFlowJsonObject[] {
  return fields.map((label) => ({
    key: label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, ''),
    label,
    type: 'text',
    required: true,
  }));
}

function apps(keys: string[]): LeadFlowJsonObject[] {
  return keys.map((key) => ({
    key,
    recommended: true,
    supportsMultipleInstances: ['whatsapp', 'email'].includes(key),
  }));
}

function integrations(keys: string[]): LeadFlowJsonObject {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      {
        enabled: true,
        supportsMultipleConnections: ['whatsapp', 'email'].includes(key),
      },
    ]),
  );
}

function prompt(system: string, user: string): LeadFlowJsonObject {
  return {
    platformSystemPromptRef: 'lyra-leadflow-platform-system-v1',
    businessModeSystemPrompt: system,
    businessModeUserPromptTemplate: user,
    variables: [
      'businessName',
      'businessSummary',
      'mainOffers',
      'businessHours',
      'handoffRules',
      'tone',
    ],
  };
}

const commonConversationFields: ConversationQualificationFieldRule[] = [
  fieldRule('lead_name', 'business_context.leadName'),
  fieldRule('company', 'business_context.company'),
  fieldRule('niche', 'business_context.leadNiche'),
  fieldRule(
    'paid_ads_experience',
    'business_context.paidAdsExperience',
    'boolean',
  ),
  fieldRule('need', 'business_context.need'),
  fieldRule('service_interest', 'business_context.projectType'),
  fieldRule('urgency', 'business_context.urgency'),
  fieldRule('budget', 'business_context.budget'),
  fieldRule('deadline', 'business_context.deadline'),
  fieldRule('objection', 'business_context.objection'),
  fieldRule('intent', 'business_context.intent'),
  fieldRule('cta_accepted', 'business_context.ctaAccepted', 'boolean'),
];

function fieldRule(
  key: string,
  crmTarget: string,
  valueType: 'string' | 'number' | 'boolean' = 'string',
): ConversationQualificationFieldRule {
  return {
    key,
    source: 'conversation',
    requiredFor: [],
    crmTarget,
    valueType,
    overwritePolicy: 'human_verified_wins',
  };
}

function ctasFor(key: LeadFlowBusinessMode): string[] {
  switch (key) {
    case LeadFlowBusinessMode.AgencyServices:
      return ['schedule_diagnostic', 'request_proposal', 'talk_to_specialist'];
    case LeadFlowBusinessMode.LocalServices:
      return ['request_quote', 'schedule_service', 'talk_to_specialist'];
    case LeadFlowBusinessMode.ClinicsEsthetics:
      return [
        'request_evaluation',
        'schedule_appointment',
        'talk_to_specialist',
      ];
    case LeadFlowBusinessMode.RestaurantsFood:
      return [
        'confirm_interest',
        'provide_order_details',
        'talk_to_specialist',
      ];
    default:
      return ['confirm_interest', 'request_quote', 'talk_to_specialist'];
  }
}

function conversationPlaybook(input: {
  key: LeadFlowBusinessMode;
  goals: string[];
  fields: string[];
  recommendedApps: string[];
}): ConversationPlaybook {
  const allowedCtas = ctasFor(input.key);
  const catalogRules = qualificationFields(input.fields).map((item) => {
    const key = String(item.key);
    const known = commonConversationFields.find((rule) =>
      key.includes(rule.key),
    );
    return {
      key,
      source: 'conversation' as const,
      requiredFor: ['qualification'],
      crmTarget: known?.crmTarget ?? `business_context.${key}`,
      valueType: 'string' as const,
      overwritePolicy: 'human_verified_wins' as const,
    };
  });
  const rules: ConversationQualificationFieldRule[] = [...catalogRules];
  for (const common of commonConversationFields) {
    if (!rules.some((rule) => rule.key === common.key)) rules.push(common);
  }
  const agencyCtaFields = ['lead_name', 'niche', 'paid_ads_experience'];
  const essential =
    input.key === LeadFlowBusinessMode.AgencyServices
      ? agencyCtaFields
      : catalogRules.slice(0, 2).map((rule) => rule.key);
  const requiredContextFields =
    input.key === LeadFlowBusinessMode.AgencyServices
      ? agencyCtaFields
      : essential.slice(0, 1);
  return {
    version: 2,
    businessModeKey: input.key,
    primaryGoal: input.goals[0] ?? 'definir um proximo passo comercial',
    successOutcomes: input.goals,
    phases: [
      {
        key: 'understand',
        objective: 'compreender a necessidade atual sem repetir perguntas',
        entryCriteria: [],
        essentialFields: essential.slice(0, 1),
        optionalFields: ['company', 'niche', 'need', 'service_interest'],
        exitCriteria: ['necessidade ou interesse identificavel'],
        allowedCtas,
        guidance: [
          'demonstre compreensao antes de perguntar',
          'faca preferencialmente uma pergunta e nunca mais de duas',
          ...(input.key === LeadFlowBusinessMode.AgencyServices
            ? [
                'se o nome do lead nao estiver disponivel, pergunte como ele prefere ser chamado',
                'nao apresente CTA no primeiro contato sem nome, nicho e historico de investimento em anuncios',
              ]
            : []),
        ],
      },
      {
        key: 'qualify',
        objective: 'coletar somente os dados que mudam o proximo passo',
        entryCriteria: ['necessidade ou interesse identificavel'],
        essentialFields: essential,
        optionalFields: ['urgency', 'budget', 'deadline', 'objection'],
        exitCriteria: ['contexto minimo para CTA'],
        allowedCtas,
        guidance: [
          'nao transforme a conversa em interrogatorio',
          'CTA pode ser apresentado antes de toda a qualificacao',
        ],
      },
      {
        key: 'convert',
        objective: 'propor um proximo passo concreto e permitido',
        entryCriteria: ['contexto minimo para CTA'],
        essentialFields: [],
        optionalFields: ['intent', 'cta_accepted'],
        exitCriteria: ['CTA aceito, recusado ou encaminhado'],
        allowedCtas,
        guidance: [
          'nao confirme preco, agenda, pedido ou disponibilidade sem backend operacional',
          'apos aceite, solicite handoff quando a execucao depender de humano',
        ],
      },
    ],
    qualificationFields: rules,
    ctaPolicy: {
      allowed: allowedCtas,
      minimumContextFields: requiredContextFields.length,
      requiredContextFields,
      maxAgentRepliesWithoutCta: 3,
      requiresOperationalCapability: Object.fromEntries(
        allowedCtas
          .filter((cta) => /schedule|appointment|order/.test(cta))
          .map((cta) => [
            cta,
            input.recommendedApps.includes('appointments')
              ? 'appointments'
              : 'human_handoff',
          ]),
      ),
    },
    handoffRules: [
      { key: 'human_requested', condition: 'lead solicita uma pessoa' },
      {
        key: 'operational_execution',
        condition: 'CTA aceito exige capacidade operacional indisponivel',
      },
    ],
    refusalRules: [
      {
        key: 'clear_refusal',
        behavior:
          'reconhecer a recusa, nao insistir e encerrar com naturalidade',
      },
    ],
  };
}

function template(input: {
  key: LeadFlowBusinessMode;
  name: string;
  description: string;
  category: string;
  stageNames: string[];
  goals: string[];
  fields: string[];
  promptSystem: string;
  promptUser: string;
  recommendedApps: string[];
  supportedIntegrations: string[];
}): LeadFlowBusinessModeTemplateCatalogItem {
  return {
    key: input.key,
    name: input.name,
    description: input.description,
    category: input.category,
    version: 1,
    status: LeadFlowSettingsStatus.Active,
    isOfficial: true,
    isSystem: true,
    isDeveloperOnly: false,
    pipelineTemplate: stages(input.stageNames),
    conversionGoals: {
      primary: input.goals[0],
      secondary: input.goals.slice(1),
      measurementWindowDays: 30,
    },
    qualificationFields: qualificationFields(input.fields),
    agentPromptTemplate: prompt(input.promptSystem, input.promptUser),
    clientPromptSchema,
    inboxRules: defaultInboxRules,
    handoffRules: defaultHandoffRules,
    recommendedApps: apps(input.recommendedApps),
    supportedIntegrations: integrations(input.supportedIntegrations),
    developerOverridesSchema,
    contextDefaults: getContextDefaults(input.key),
    metadata: {
      source: 'lyra_official_catalog',
      locale: 'pt-BR',
      initialRelease: true,
      contextDefaults: getContextDefaults(input.key),
      conversationPlaybook: conversationPlaybook({
        key: input.key,
        goals: input.goals,
        fields: input.fields,
        recommendedApps: input.recommendedApps,
      }) as unknown as LeadFlowJsonObject,
    },
  };
}

export const LEADFLOW_BUSINESS_MODE_TEMPLATES: LeadFlowBusinessModeTemplateCatalogItem[] =
  [
    template({
      key: LeadFlowBusinessMode.AgencyServices,
      name: 'Agencia e servicos profissionais',
      description:
        'Capta, qualifica e encaminha leads para agencias, consultorias e prestadores B2B.',
      category: 'services',
      stageNames: [
        'Novo lead',
        'Qualificado',
        'Diagnostico',
        'Proposta',
        'Fechado',
      ],
      goals: ['agendar diagnostico', 'enviar proposta', 'capturar briefing'],
      fields: ['Tipo de projeto', 'Orcamento estimado', 'Prazo desejado'],
      promptSystem:
        'Atue como consultor comercial, entenda o contexto do lead e conduza para um diagnostico objetivo.',
      promptUser:
        'Use os dados do formulario para qualificar fit, urgencia e escopo antes de sugerir proximo passo.',
      recommendedApps: ['whatsapp', 'forms', 'appointments', 'contacts'],
      supportedIntegrations: ['whatsapp', 'webchat', 'email'],
    }),
    template({
      key: LeadFlowBusinessMode.LocalServices,
      name: 'Servicos locais',
      description:
        'Organiza pedidos de orcamento e agendamento para negocios locais de atendimento rapido.',
      category: 'local_services',
      stageNames: [
        'Novo pedido',
        'Triagem',
        'Orcamento',
        'Agendado',
        'Concluido',
      ],
      goals: ['agendar atendimento', 'estimar servico', 'confirmar endereco'],
      fields: ['Servico desejado', 'Bairro ou cidade', 'Janela de horario'],
      promptSystem:
        'Atue com objetividade, colete dados essenciais do servico e reduza friccao para agendamento.',
      promptUser:
        'Priorize localizacao, urgencia e detalhes praticos para permitir resposta comercial rapida.',
      recommendedApps: ['whatsapp', 'appointments', 'contacts'],
      supportedIntegrations: ['whatsapp', 'webchat'],
    }),
    template({
      key: LeadFlowBusinessMode.ClinicsEsthetics,
      name: 'Clinicas e estetica',
      description:
        'Qualifica interessados em consultas, procedimentos esteticos e tratamentos recorrentes.',
      category: 'health_beauty',
      stageNames: [
        'Novo interesse',
        'Pre-avaliacao',
        'Consulta marcada',
        'Compareceu',
        'Conversao',
      ],
      goals: ['marcar avaliacao', 'entender procedimento', 'reduzir faltas'],
      fields: [
        'Procedimento de interesse',
        'Objetivo do paciente',
        'Disponibilidade',
      ],
      promptSystem:
        'Atue com acolhimento e responsabilidade, sem diagnosticar ou prometer resultados clinicos.',
      promptUser:
        'Colete objetivo, historico relevante informado espontaneamente e preferencia de agenda.',
      recommendedApps: ['whatsapp', 'appointments', 'contacts'],
      supportedIntegrations: ['whatsapp', 'webchat'],
    }),
    template({
      key: LeadFlowBusinessMode.RestaurantsFood,
      name: 'Restaurantes e alimentacao',
      description:
        'Atende pedidos, reservas, eventos e oportunidades comerciais para operacoes de alimentacao.',
      category: 'food',
      stageNames: [
        'Novo contato',
        'Pedido ou reserva',
        'Confirmacao',
        'Em atendimento',
        'Finalizado',
      ],
      goals: ['confirmar reserva', 'capturar pedido', 'direcionar evento'],
      fields: [
        'Tipo de solicitacao',
        'Data e horario',
        'Quantidade de pessoas',
      ],
      promptSystem:
        'Atue com rapidez e clareza para reservas, pedidos e duvidas sobre cardapio ou eventos.',
      promptUser:
        'Identifique se o contato e pedido, reserva, delivery, evento ou suporte e direcione corretamente.',
      recommendedApps: ['whatsapp', 'webchat', 'contacts'],
      supportedIntegrations: ['whatsapp', 'webchat'],
    }),
    template({
      key: LeadFlowBusinessMode.RealEstate,
      name: 'Imobiliario',
      description:
        'Qualifica compradores, locatarios e proprietarios para times imobiliarios.',
      category: 'real_estate',
      stageNames: [
        'Novo lead',
        'Perfil validado',
        'Imoveis sugeridos',
        'Visita marcada',
        'Negociacao',
      ],
      goals: [
        'marcar visita',
        'qualificar perfil',
        'capturar preferencia de imovel',
      ],
      fields: ['Tipo de imovel', 'Faixa de investimento', 'Regiao desejada'],
      promptSystem:
        'Atue como assistente imobiliario consultivo, focando perfil, regiao, faixa e proximo passo.',
      promptUser:
        'Pergunte sobre compra ou locacao, urgencia, financiamento e criterios essenciais.',
      recommendedApps: ['whatsapp', 'appointments', 'contacts'],
      supportedIntegrations: ['whatsapp', 'webchat', 'email'],
    }),
    template({
      key: LeadFlowBusinessMode.EducationCourses,
      name: 'Educacao e cursos',
      description:
        'Converte interessados em cursos, mentorias, escolas e programas educacionais.',
      category: 'education',
      stageNames: [
        'Novo interessado',
        'Perfil academico',
        'Turma indicada',
        'Matricula iniciada',
        'Matriculado',
      ],
      goals: ['indicar curso', 'agendar conversa', 'iniciar matricula'],
      fields: ['Curso de interesse', 'Nivel atual', 'Objetivo de aprendizagem'],
      promptSystem:
        'Atue como consultor educacional, conectando objetivo do aluno ao programa mais adequado.',
      promptUser:
        'Colete objetivo, disponibilidade, nivel atual e criterio de decisao antes de recomendar proximo passo.',
      recommendedApps: ['whatsapp', 'forms', 'appointments', 'email'],
      supportedIntegrations: ['whatsapp', 'webchat', 'email'],
    }),
    template({
      key: LeadFlowBusinessMode.Automotive,
      name: 'Automotivo',
      description:
        'Atende leads para compra, venda, servicos, financiamento e pos-venda automotivo.',
      category: 'automotive',
      stageNames: [
        'Novo lead',
        'Veiculo identificado',
        'Avaliacao',
        'Proposta',
        'Fechamento',
      ],
      goals: ['agendar visita', 'avaliar veiculo', 'simular proposta'],
      fields: [
        'Modelo ou servico',
        'Ano ou faixa desejada',
        'Forma de pagamento',
      ],
      promptSystem:
        'Atue como consultor automotivo objetivo, coletando dados de veiculo, perfil e intencao.',
      promptUser:
        'Diferencie compra, venda, troca ou servico e encaminhe com dados suficientes.',
      recommendedApps: ['whatsapp', 'appointments', 'contacts'],
      supportedIntegrations: ['whatsapp', 'webchat'],
    }),
    template({
      key: LeadFlowBusinessMode.RetailStore,
      name: 'Loja fisica e varejo',
      description:
        'Apoia vendas consultivas, disponibilidade de produtos e relacionamento no varejo presencial.',
      category: 'retail',
      stageNames: [
        'Novo contato',
        'Produto consultado',
        'Disponibilidade validada',
        'Reserva',
        'Compra',
      ],
      goals: ['reservar produto', 'direcionar loja', 'capturar preferencia'],
      fields: [
        'Produto desejado',
        'Unidade ou cidade',
        'Preferencia de retirada',
      ],
      promptSystem:
        'Atue como vendedor de loja, confirmando interesse, disponibilidade e melhor canal de compra.',
      promptUser:
        'Colete produto, variacao, localidade e urgencia para encaminhar a venda ou reserva.',
      recommendedApps: ['whatsapp', 'contacts'],
      supportedIntegrations: ['whatsapp', 'webchat'],
    }),
    template({
      key: LeadFlowBusinessMode.EcommerceLight,
      name: 'E-commerce leve',
      description:
        'Qualifica duvidas, carrinhos e pedidos para operacoes digitais pequenas e medias.',
      category: 'ecommerce',
      stageNames: [
        'Novo contato',
        'Produto de interesse',
        'Carrinho assistido',
        'Pedido iniciado',
        'Compra',
      ],
      goals: [
        'recuperar carrinho',
        'responder duvida de produto',
        'iniciar pedido',
      ],
      fields: [
        'Produto de interesse',
        'Duvida principal',
        'Preferencia de entrega',
      ],
      promptSystem:
        'Atue como assistente de compra digital, removendo duvidas e conduzindo para pedido.',
      promptUser:
        'Identifique produto, objecao, frete, prazo e proximo passo de compra.',
      recommendedApps: ['whatsapp', 'webchat', 'email', 'contacts'],
      supportedIntegrations: ['whatsapp', 'webchat', 'email'],
    }),
    template({
      key: LeadFlowBusinessMode.EventsTourism,
      name: 'Eventos e turismo',
      description:
        'Qualifica reservas, pacotes, eventos corporativos, grupos e experiencias.',
      category: 'events_tourism',
      stageNames: [
        'Novo interesse',
        'Perfil da experiencia',
        'Cotacao',
        'Reserva',
        'Confirmado',
      ],
      goals: ['enviar cotacao', 'confirmar reserva', 'capturar datas'],
      fields: ['Tipo de experiencia', 'Data desejada', 'Numero de pessoas'],
      promptSystem:
        'Atue como consultor de experiencias, equilibrando encantamento, logistica e viabilidade.',
      promptUser:
        'Colete data, quantidade de pessoas, preferencia, restricoes e faixa de investimento.',
      recommendedApps: ['whatsapp', 'forms', 'appointments', 'contacts'],
      supportedIntegrations: ['whatsapp', 'webchat', 'email'],
    }),
    template({
      key: LeadFlowBusinessMode.LegalAccounting,
      name: 'Juridico e contabilidade',
      description:
        'Triagem inicial para escritorios juridicos, contabeis e consultorias reguladas.',
      category: 'professional_services',
      stageNames: [
        'Novo contato',
        'Triagem',
        'Documentos solicitados',
        'Consulta marcada',
        'Em analise',
      ],
      goals: [
        'marcar consulta',
        'identificar area',
        'solicitar documentos basicos',
      ],
      fields: ['Area do atendimento', 'Prazo ou urgencia', 'Resumo do caso'],
      promptSystem:
        'Atue como triagem profissional, sem oferecer aconselhamento juridico, fiscal ou promessas.',
      promptUser:
        'Colete area, urgencia, contexto e dados para que um especialista humano assuma quando necessario.',
      recommendedApps: ['whatsapp', 'forms', 'appointments', 'email'],
      supportedIntegrations: ['whatsapp', 'webchat', 'email'],
    }),
    template({
      key: LeadFlowBusinessMode.FitnessWellness,
      name: 'Fitness e bem-estar',
      description:
        'Converte interessados em planos, aulas, personal, studios e programas de bem-estar.',
      category: 'fitness_wellness',
      stageNames: [
        'Novo interessado',
        'Objetivo identificado',
        'Plano sugerido',
        'Aula experimental',
        'Matriculado',
      ],
      goals: [
        'agendar aula experimental',
        'indicar plano',
        'capturar objetivo',
      ],
      fields: [
        'Objetivo principal',
        'Nivel atual',
        'Disponibilidade de horarios',
      ],
      promptSystem:
        'Atue como consultor de bem-estar motivador, sem prescrever treino ou dieta individualizada.',
      promptUser:
        'Colete objetivo, experiencia, disponibilidade e preferencias para encaminhar o melhor plano.',
      recommendedApps: ['whatsapp', 'appointments', 'contacts'],
      supportedIntegrations: ['whatsapp', 'webchat'],
    }),
  ];

export function getCatalogConversationPlaybook(key: string) {
  const template = LEADFLOW_BUSINESS_MODE_TEMPLATES.find(
    (item) => item.key === key,
  );
  const value = template?.metadata?.conversationPlaybook;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as unknown as ConversationPlaybook)
    : null;
}
