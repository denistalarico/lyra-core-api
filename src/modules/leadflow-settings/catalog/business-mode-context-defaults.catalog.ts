import { LeadFlowBusinessMode } from '../enums/leadflow-business-mode.enum';
import type { LeadFlowJsonObject } from '../types/leadflow-settings.types';

/**
 * Per-Business-Mode starting copy for the company context.
 *
 * These used to live in the web app (`agentDefaults.ts`), where they could only
 * pre-fill a form field — so the end user still faced every one of them as
 * something to read and approve. Owning them here makes them *product
 * decisions*: the values are seeded into the draft when the configuration is
 * created, the agent uses them from minute one, and the UI never has to render
 * them unless Developer Mode is on.
 *
 * Values are keyed by canonical company-context path (see
 * `CompanyContextService`), so they merge into the draft without translation.
 * Anything the operator (or the briefing) later writes overwrites them.
 */

export type LeadFlowContextDefaults = {
  identity?: { targetAudience?: string };
  service?: {
    serviceLevel?: string;
    emergencyRules?: string;
    unsupportedRequests?: string;
  };
  qualification?: {
    conversionGoal?: string;
    preferredCta?: string;
    qualifiedCriteria?: string;
    disqualificationCriteria?: string;
    urgencySignals?: string;
  };
};

/** Field paths this catalog is allowed to seed. Nothing else is a "default". */
export const LEADFLOW_CONTEXT_DEFAULT_PATHS = [
  'identity.targetAudience',
  'service.serviceLevel',
  'service.emergencyRules',
  'service.unsupportedRequests',
  'qualification.conversionGoal',
  'qualification.preferredCta',
  'qualification.qualifiedCriteria',
  'qualification.disqualificationCriteria',
  'qualification.urgencySignals',
] as const;

const GENERIC: LeadFlowContextDefaults = {
  identity: {
    targetAudience:
      'Pessoas e empresas que procuram a solução oferecida pelo negócio e ainda estão avaliando fornecedores.',
  },
  service: {
    serviceLevel:
      'Responder em até 5 minutos no horário de atendimento e no início do próximo turno fora dele.',
    emergencyRules:
      'Casos urgentes ou reclamações são encaminhados imediatamente para uma pessoa do time.',
    unsupportedRequests:
      'O agente não confirma preço final, prazo, disponibilidade nem fecha contrato sozinho.',
  },
  qualification: {
    conversionGoal: 'Gerar um lead qualificado com próximo passo agendado.',
    preferredCta: 'Falar com um especialista',
    qualifiedCriteria:
      'Demonstra necessidade real, informa contexto mínimo e aceita um próximo passo.',
    disqualificationCriteria:
      'Fora da região atendida, procura outro serviço ou é contato de spam.',
    urgencySignals:
      'Pede atendimento imediato, cita prazo curto ou menciona concorrente já contratado.',
  },
};

const BY_MODE: Record<LeadFlowBusinessMode, LeadFlowContextDefaults> = {
  [LeadFlowBusinessMode.AgencyServices]: {
    identity: {
      targetAudience:
        'Empresas e profissionais que querem terceirizar marketing, vendas ou operação e já investem ou pretendem investir em aquisição.',
    },
    service: {
      unsupportedRequests:
        'O agente não fecha proposta, não define escopo nem confirma valores de contrato.',
    },
    qualification: {
      conversionGoal: 'Agendar um diagnóstico comercial com o time.',
      preferredCta: 'Agendar diagnóstico',
      qualifiedCriteria:
        'Tem nicho definido, informa histórico de investimento em anúncios e aceita agendar o diagnóstico.',
      disqualificationCriteria:
        'Busca vaga de emprego, parceria de permuta ou serviço fora do escopo da agência.',
    },
  },
  [LeadFlowBusinessMode.LocalServices]: {
    identity: {
      targetAudience:
        'Moradores e empresas da região que precisam de um serviço presencial com data marcada.',
    },
    qualification: {
      conversionGoal:
        'Gerar um orçamento solicitado com endereço e serviço definidos.',
      preferredCta: 'Solicitar orçamento',
      qualifiedCriteria:
        'Está dentro da área de atendimento, descreve o serviço necessário e informa quando precisa.',
      disqualificationCriteria:
        'Endereço fora da área de cobertura ou serviço que a empresa não executa.',
      urgencySignals:
        'Vazamento, pane, risco de segurança ou qualquer situação que impeça o uso do imóvel.',
    },
  },
  [LeadFlowBusinessMode.ClinicsEsthetics]: {
    identity: {
      targetAudience:
        'Pacientes que buscam avaliação, tratamento estético ou acompanhamento clínico na região da clínica.',
    },
    service: {
      unsupportedRequests:
        'O agente não faz diagnóstico, não indica tratamento, não prescreve e não confirma resultado clínico.',
      emergencyRules:
        'Queixa de dor, reação adversa ou intercorrência pós-procedimento vai imediatamente para uma pessoa do time.',
    },
    qualification: {
      conversionGoal: 'Agendar uma avaliação presencial.',
      preferredCta: 'Agendar avaliação',
      qualifiedCriteria:
        'Informa o procedimento de interesse, a disponibilidade e aceita agendar a avaliação.',
      disqualificationCriteria:
        'Procura procedimento não oferecido, é menor sem responsável ou está fora da região.',
    },
  },
  [LeadFlowBusinessMode.RestaurantsFood]: {
    identity: {
      targetAudience:
        'Clientes que querem reservar mesa, pedir delivery ou contratar um evento gastronômico.',
    },
    service: {
      unsupportedRequests:
        'O agente não confirma disponibilidade de mesa, estoque, prazo de entrega nem cobrança.',
    },
    qualification: {
      conversionGoal:
        'Registrar um pedido ou uma reserva com os dados completos.',
      preferredCta: 'Confirmar interesse',
      qualifiedCriteria:
        'Informa data, número de pessoas ou itens do pedido e aceita o próximo passo.',
      disqualificationCriteria:
        'Solicita entrega fora da área ou item que não está no cardápio.',
    },
  },
  [LeadFlowBusinessMode.RealEstate]: {
    identity: {
      targetAudience:
        'Compradores, locatários e investidores procurando imóvel na região atendida pela imobiliária.',
    },
    qualification: {
      conversionGoal: 'Agendar uma visita ao imóvel.',
      preferredCta: 'Agendar visita',
      qualifiedCriteria:
        'Informa finalidade (compra ou locação), faixa de valor, região e disponibilidade para visita.',
      disqualificationCriteria:
        'Procura imóvel fora da carteira, região não atendida ou apenas pesquisa de mercado.',
      urgencySignals:
        'Mudança com data marcada, fim de contrato de locação ou proposta concorrente em andamento.',
    },
  },
  [LeadFlowBusinessMode.EducationCourses]: {
    identity: {
      targetAudience:
        'Alunos e responsáveis avaliando cursos, turmas e formas de ingresso.',
    },
    qualification: {
      conversionGoal:
        'Gerar uma matrícula iniciada ou uma aula experimental agendada.',
      preferredCta: 'Agendar aula experimental',
      qualifiedCriteria:
        'Informa o curso de interesse, o turno desejado e aceita conversar com a secretaria.',
      disqualificationCriteria:
        'Procura curso não ofertado ou modalidade indisponível na unidade.',
      urgencySignals:
        'Turma com matrícula encerrando ou início de aulas próximo.',
    },
  },
  [LeadFlowBusinessMode.Automotive]: {
    identity: {
      targetAudience:
        'Proprietários de veículos e compradores avaliando serviço, revisão ou negociação.',
    },
    qualification: {
      conversionGoal: 'Agendar um atendimento na oficina ou na loja.',
      preferredCta: 'Agendar atendimento',
      qualifiedCriteria:
        'Informa veículo, ano e o serviço ou modelo de interesse, e aceita agendar.',
      disqualificationCriteria:
        'Veículo ou serviço fora da especialidade atendida pela empresa.',
      urgencySignals:
        'Veículo parado, guincho a caminho ou falha que impede o uso imediato.',
    },
  },
  [LeadFlowBusinessMode.RetailStore]: {
    identity: {
      targetAudience:
        'Consumidores da região procurando produtos disponíveis na loja física.',
    },
    service: {
      unsupportedRequests:
        'O agente não confirma estoque, preço promocional nem prazo de reposição.',
    },
    qualification: {
      conversionGoal: 'Levar o cliente à loja ou registrar um pedido reservado.',
      preferredCta: 'Reservar produto',
      qualifiedCriteria:
        'Informa o produto desejado, a quantidade e quando pretende retirar.',
      disqualificationCriteria:
        'Produto não comercializado ou pedido de revenda fora da política da loja.',
    },
  },
  [LeadFlowBusinessMode.EcommerceLight]: {
    identity: {
      targetAudience:
        'Compradores online que já conhecem o produto e precisam de apoio para finalizar o pedido.',
    },
    service: {
      unsupportedRequests:
        'O agente não confirma frete, prazo, estoque nem status de pagamento.',
    },
    qualification: {
      conversionGoal: 'Recuperar o carrinho e concluir o pedido.',
      preferredCta: 'Concluir pedido',
      qualifiedCriteria:
        'Identifica o produto, informa o CEP de entrega e demonstra intenção de compra.',
      disqualificationCriteria:
        'Pedido de troca sem compra registrada, revenda ou entrega fora da cobertura.',
    },
  },
  [LeadFlowBusinessMode.EventsTourism]: {
    identity: {
      targetAudience:
        'Pessoas e empresas planejando viagens, eventos ou experiências com data prevista.',
    },
    qualification: {
      conversionGoal:
        'Gerar uma proposta solicitada com data e número de pessoas.',
      preferredCta: 'Solicitar proposta',
      qualifiedCriteria:
        'Informa data, quantidade de pessoas e faixa de investimento pretendida.',
      disqualificationCriteria:
        'Destino ou formato de evento não operado pela empresa.',
      urgencySignals: 'Data próxima, alta temporada ou disponibilidade limitada.',
    },
  },
  [LeadFlowBusinessMode.LegalAccounting]: {
    identity: {
      targetAudience:
        'Pessoas e empresas que precisam de apoio jurídico ou contábil recorrente ou pontual.',
    },
    service: {
      unsupportedRequests:
        'O agente não emite parecer, não orienta juridicamente e não estima honorários.',
      emergencyRules:
        'Prazo processual, intimação ou fiscalização em curso é encaminhado imediatamente ao responsável.',
    },
    qualification: {
      conversionGoal: 'Agendar uma consulta inicial com o responsável técnico.',
      preferredCta: 'Agendar consulta',
      qualifiedCriteria:
        'Descreve a demanda, informa se é pessoa física ou jurídica e aceita agendar a consulta.',
      disqualificationCriteria:
        'Área do direito ou regime contábil que o escritório não atende.',
    },
  },
  [LeadFlowBusinessMode.FitnessWellness]: {
    identity: {
      targetAudience:
        'Pessoas buscando treino, acompanhamento e bem-estar perto de onde moram ou trabalham.',
    },
    service: {
      unsupportedRequests:
        'O agente não prescreve treino, dieta ou conduta de saúde.',
    },
    qualification: {
      conversionGoal: 'Agendar uma aula experimental ou avaliação física.',
      preferredCta: 'Agendar aula experimental',
      qualifiedCriteria:
        'Informa o objetivo, a disponibilidade de horário e aceita a aula experimental.',
      disqualificationCriteria:
        'Procura modalidade não oferecida ou unidade fora da região atendida.',
    },
  },
};

/**
 * Full defaults for a mode: the generic baseline with the mode's own copy on
 * top, section by section, so a mode that only overrides `qualification` still
 * inherits the generic `service` guardrails.
 */
export function getContextDefaults(
  businessModeKey: LeadFlowBusinessMode,
): LeadFlowJsonObject {
  const mode = BY_MODE[businessModeKey] ?? {};

  return {
    identity: { ...GENERIC.identity, ...mode.identity },
    service: { ...GENERIC.service, ...mode.service },
    qualification: { ...GENERIC.qualification, ...mode.qualification },
  };
}
