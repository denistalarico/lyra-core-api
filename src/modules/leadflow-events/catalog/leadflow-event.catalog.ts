import { LeadFlowEventStatus } from '../enums/leadflow-event-status.enum';
import type {
  LeadFlowEventCatalogItem,
  LeadFlowEventContext,
  LeadFlowEventModuleKey,
  LeadFlowEventName,
  LeadFlowEventPayloadField,
  LeadFlowEventPayloadFieldType,
  LeadFlowEventPayloadSchema,
  LeadFlowEventStructuralRule,
  LeadFlowEventTriggerMapping,
} from '../types/leadflow-event.types';

/**
 * In-memory LeadFlow event catalog (blueprint section 10) — the same pattern
 * used by Agents presets and Automations recipes. Nothing here is emitted,
 * persisted or executed; `status` describes the contract lifecycle only
 * (`active` = stable and accepted by durable fan-out, `planned` = deferred).
 */

function field(
  type: LeadFlowEventPayloadFieldType,
  required: boolean,
  description: string,
): LeadFlowEventPayloadField {
  return { type, required, description };
}

/** Shared "which fields changed" payload — names only, never raw values. */
const CHANGED_FIELDS: LeadFlowEventPayloadSchema = {
  changedFields: field(
    'array',
    true,
    'Nomes dos campos alterados (apenas nomes, nunca valores brutos).',
  ),
};

/** Consumers declared at contract level; Automations has durable ingress. */
const FUTURE_CONSUMERS = ['leadflow.automations', 'leadflow.analytics'];

interface EventSeed {
  eventName: LeadFlowEventName;
  description: string;
  requiredContext?: (keyof LeadFlowEventContext & string)[];
  payloadSchema?: LeadFlowEventPayloadSchema;
  emittedBy?: string;
  consumedBy?: string[];
  sensitive?: boolean;
  status?: LeadFlowEventStatus;
}

function buildEvent(seed: EventSeed): LeadFlowEventCatalogItem {
  const segments = seed.eventName.split('.');
  const moduleKey = `leadflow.${segments[1]}` as LeadFlowEventModuleKey;

  return {
    eventName: seed.eventName,
    eventVersion: 1,
    moduleKey,
    resource: segments.slice(2, -1).join('.'),
    action: segments[segments.length - 1],
    description: seed.description,
    requiredContext: seed.requiredContext ?? [],
    payloadSchema: seed.payloadSchema ?? {},
    emittedBy: seed.emittedBy ?? moduleKey,
    consumedBy: seed.consumedBy ?? [...FUTURE_CONSUMERS],
    sensitive: seed.sensitive ?? false,
    status: seed.status ?? LeadFlowEventStatus.Active,
  };
}

export const LEADFLOW_EVENT_CATALOG: LeadFlowEventCatalogItem[] = [
  // ── Inbox ────────────────────────────────────────────────────────────────
  buildEvent({
    eventName: 'leadflow.inbox.conversation.created',
    description:
      'Nova conversa criada no Inbox. Participa da regra estrutural Inbox → CRM (toda conversa gera ou vincula oportunidade).',
    requiredContext: ['conversationId'],
    payloadSchema: {
      channel: field('string', true, 'Canal de origem (whatsapp, webchat...).'),
      origin: field('string', false, 'Origem da conversa (inbound, outbound).'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.inbox.conversation.updated',
    description: 'Dados da conversa atualizados (título, tags, metadados).',
    requiredContext: ['conversationId'],
    payloadSchema: CHANGED_FIELDS,
  }),
  buildEvent({
    eventName: 'leadflow.inbox.conversation.message.received',
    description:
      'Mensagem recebida do contato. Carrega apenas ids e resumo opcional — nunca o conteúdo bruto completo nem payload de webhook com credenciais.',
    requiredContext: ['conversationId', 'contactId'],
    payloadSchema: {
      messageId: field('string', true, 'Id da mensagem no Inbox.'),
      messageType: field(
        'string',
        true,
        'Tipo (text, image, audio, document).',
      ),
      hasMedia: field('boolean', false, 'Se a mensagem contém mídia.'),
      summary: field(
        'string',
        false,
        'Resumo curto opcional da mensagem (nunca o texto integral).',
      ),
    },
    sensitive: true,
  }),
  buildEvent({
    eventName: 'leadflow.inbox.conversation.message.sent',
    description:
      'Mensagem enviada ao contato (por usuário, agente ou sistema). Apenas ids e tipo — sem conteúdo bruto.',
    requiredContext: ['conversationId', 'contactId'],
    payloadSchema: {
      messageId: field('string', true, 'Id da mensagem no Inbox.'),
      messageType: field(
        'string',
        true,
        'Tipo (text, image, audio, document).',
      ),
      authorType: field('string', false, 'Quem enviou (user, agent, system).'),
    },
    sensitive: true,
  }),
  buildEvent({
    eventName: 'leadflow.inbox.conversation.idle',
    description:
      'Conversa sem resposta do lead há N horas. Detectado por um scheduler futuro — nenhum detector roda neste sprint.',
    requiredContext: ['conversationId'],
    payloadSchema: {
      idleSince: field('string', true, 'ISO da última interação do lead.'),
      idleHours: field('number', true, 'Horas de inatividade detectadas.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.inbox.conversation.assigned',
    description: 'Conversa atribuída a um usuário responsável.',
    requiredContext: ['conversationId'],
    payloadSchema: {
      assignedUserId: field('string', true, 'Usuário que assumiu a conversa.'),
      previousUserId: field(
        'string',
        false,
        'Responsável anterior, se houver.',
      ),
    },
  }),
  buildEvent({
    eventName: 'leadflow.inbox.conversation.handoff.requested',
    description:
      'Handoff para humano solicitado (pelo lead, por regra ou por agente).',
    requiredContext: ['conversationId'],
    payloadSchema: {
      reason: field('string', false, 'Motivo do handoff (keyword, intent...).'),
      triggerKeyword: field('string', false, 'Palavra-chave que disparou.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.inbox.conversation.handoff.accepted',
    description: 'Handoff aceito por um humano; agente pausa na conversa.',
    requiredContext: ['conversationId'],
    payloadSchema: {
      acceptedByUserId: field('string', true, 'Usuário que assumiu.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.inbox.conversation.closed',
    description: 'Conversa encerrada no Inbox.',
    requiredContext: ['conversationId'],
    payloadSchema: {
      closeReason: field('string', false, 'Motivo do encerramento.'),
    },
  }),

  // ── CRM / Leads ──────────────────────────────────────────────────────────
  buildEvent({
    eventName: 'leadflow.crm.opportunity.created',
    description:
      'Oportunidade/card criada no CRM. Participa da regra estrutural Inbox → CRM.',
    requiredContext: ['opportunityId'],
    payloadSchema: {
      pipelineId: field('string', false, 'Pipeline onde o card nasceu.'),
      stageId: field('string', true, 'Estágio inicial do card.'),
      source: field('string', false, 'Origem (inbox, manual, import...).'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.copied',
    description:
      'Nova negociação relacionada criada com lineage explícita, sem copiar conversa, mensagens, atividades ou anexos.',
    requiredContext: ['opportunityId', 'contactId'],
    payloadSchema: {
      sourceOpportunityId: field('string', true, 'Oportunidade de origem.'),
      pipelineId: field('string', true, 'Pipeline da nova negociação.'),
      stageId: field('string', true, 'Estágio inicial escolhido.'),
      reasonCode: field('string', true, 'Motivo governado da cópia.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.reconverted',
    description:
      'Novo ciclo comercial criado para contato existente sem reabrir a oportunidade terminal anterior.',
    requiredContext: ['opportunityId', 'contactId'],
    payloadSchema: {
      sourceOpportunityId: field(
        'string',
        true,
        'Oportunidade terminal do ciclo anterior.',
      ),
      conversationId: field(
        'string',
        false,
        'Conversa cujo ponteiro primário passou ao novo ciclo.',
      ),
      pipelineId: field(
        'string',
        true,
        'Pipeline resolvido para o novo ciclo.',
      ),
      stageId: field('string', true, 'Estágio inicial resolvido.'),
      reasonCode: field('string', true, 'Motivo governado da reconversão.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.updated',
    description: 'Dados da oportunidade atualizados.',
    requiredContext: ['opportunityId'],
    payloadSchema: CHANGED_FIELDS,
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.stage.changed',
    description: 'Oportunidade movida de estágio no kanban.',
    requiredContext: ['opportunityId'],
    payloadSchema: {
      fromStageId: field('string', true, 'Estágio anterior.'),
      toStageId: field('string', true, 'Novo estágio.'),
      pipelineId: field('string', false, 'Pipeline do movimento.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.pipeline.exited',
    description: 'Oportunidade saiu de um pipeline durante transferência.',
    requiredContext: ['opportunityId'],
    payloadSchema: {
      pipelineId: field('string', true, 'Pipeline de origem.'),
      stageId: field('string', false, 'Último estágio no pipeline de origem.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.stage.exited',
    description: 'Oportunidade saiu de um estágio durante transferência.',
    requiredContext: ['opportunityId'],
    payloadSchema: {
      pipelineId: field('string', true, 'Pipeline de origem.'),
      stageId: field('string', true, 'Estágio de origem.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.pipeline.transferred',
    description:
      'Oportunidade canônica transferida atomicamente entre pipelines.',
    requiredContext: ['opportunityId'],
    payloadSchema: {
      fromPipelineId: field('string', true, 'Pipeline de origem.'),
      fromStageId: field('string', true, 'Estágio de origem.'),
      toPipelineId: field('string', true, 'Pipeline de destino.'),
      toStageId: field('string', true, 'Estágio de destino.'),
      transferMode: field('string', true, 'Modo manual ou handoff.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.pipeline.entered',
    description: 'Oportunidade entrou no pipeline de destino.',
    requiredContext: ['opportunityId'],
    payloadSchema: {
      pipelineId: field('string', true, 'Pipeline de destino.'),
      stageId: field('string', false, 'Primeiro estágio no destino.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.stage.entered',
    description: 'Oportunidade entrou no estágio de destino.',
    requiredContext: ['opportunityId'],
    payloadSchema: {
      pipelineId: field('string', true, 'Pipeline de destino.'),
      stageId: field('string', true, 'Estágio de destino.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.score.changed',
    description:
      'Score da oportunidade alterado (base para hot lead notification futura).',
    requiredContext: ['opportunityId'],
    payloadSchema: {
      previousScore: field('number', true, 'Score anterior.'),
      newScore: field('number', true, 'Novo score.'),
      scoreReason: field('string', false, 'Motivo resumido da mudança.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.status.changed',
    description: 'Status da oportunidade alterado (open, won, lost...).',
    requiredContext: ['opportunityId'],
    payloadSchema: {
      fromStatus: field('string', true, 'Status anterior.'),
      toStatus: field('string', true, 'Novo status.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.owner.changed',
    description: 'Responsável pela oportunidade alterado.',
    requiredContext: ['opportunityId'],
    payloadSchema: {
      fromUserId: field('string', false, 'Responsável anterior.'),
      toUserId: field('string', true, 'Novo responsável.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.won',
    description: 'Oportunidade marcada como ganha.',
    requiredContext: ['opportunityId'],
    payloadSchema: {
      valueAmount: field('number', false, 'Valor fechado, se informado.'),
      currency: field('string', false, 'Moeda do valor.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.lost',
    description: 'Oportunidade marcada como perdida.',
    requiredContext: ['opportunityId'],
    payloadSchema: {
      lostReason: field('string', false, 'Motivo da perda.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.idle',
    description:
      'Oportunidade parada no mesmo estágio há N horas. Detectado por scheduler futuro.',
    requiredContext: ['opportunityId'],
    payloadSchema: {
      idleSince: field('string', true, 'ISO da última movimentação.'),
      idleHoursInStage: field('number', true, 'Horas paradas no estágio.'),
      stageId: field('string', false, 'Estágio atual.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.opportunity.linked_to_conversation',
    description:
      'Oportunidade vinculada a uma conversa do Inbox — evento central da regra estrutural Inbox → CRM. Este sprint só define o contrato; a execução não é implementada.',
    requiredContext: ['opportunityId', 'conversationId'],
    payloadSchema: {
      linkType: field(
        'string',
        true,
        'created (card novo) ou linked (existente).',
      ),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.contact.created',
    description:
      'Contato criado no CRM. Participa da regra estrutural Inbox → CRM.',
    requiredContext: ['contactId'],
    payloadSchema: {
      source: field('string', false, 'Origem (inbox, manual, import...).'),
      channel: field('string', false, 'Canal de entrada do contato.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.crm.contact.updated',
    description: 'Dados do contato atualizados.',
    requiredContext: ['contactId'],
    payloadSchema: CHANGED_FIELDS,
  }),

  // ── Agents ───────────────────────────────────────────────────────────────
  buildEvent({
    eventName: 'leadflow.agents.agent.provisioned',
    description: 'Agente provisionado a partir de um preset do catálogo.',
    requiredContext: ['agentId'],
    payloadSchema: {
      presetKey: field('string', false, 'Preset de origem, se houver.'),
      agentType: field('string', true, 'Tipo do agente.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.agents.agent.updated',
    description: 'Configuração do agente atualizada.',
    requiredContext: ['agentId'],
    payloadSchema: CHANGED_FIELDS,
  }),
  buildEvent({
    eventName: 'leadflow.agents.agent.activated',
    description: 'Agente ativado.',
    requiredContext: ['agentId'],
    payloadSchema: {
      previousStatus: field('string', false, 'Status anterior.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.agents.agent.paused',
    description: 'Agente pausado.',
    requiredContext: ['agentId'],
    payloadSchema: {
      reason: field('string', false, 'Motivo da pausa.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.agents.agent.published',
    description: 'Versão do agente publicada.',
    requiredContext: ['agentId'],
    payloadSchema: {
      versionId: field('string', true, 'Versão publicada.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.agents.runtime.config.updated',
    description:
      'Runtime contract de agentes regenerado para o contexto (nunca inclui prompt bruto nem secrets).',
    payloadSchema: {
      configVersion: field('number', false, 'Versão do contrato gerado.'),
    },
  }),

  // ── Automations (ciclo de configuração) ──────────────────────────────────
  buildEvent({
    eventName: 'leadflow.automations.automation.provisioned',
    description: 'Automação provisionada a partir de uma receita do catálogo.',
    requiredContext: ['automationId'],
    payloadSchema: {
      recipeKey: field('string', true, 'Receita de origem.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.automations.automation.updated',
    description: 'Configuração da automação atualizada.',
    requiredContext: ['automationId'],
    payloadSchema: CHANGED_FIELDS,
  }),
  buildEvent({
    eventName: 'leadflow.automations.automation.activated',
    description:
      'Automação ativada após validação de dependências e executores disponíveis.',
    requiredContext: ['automationId'],
    payloadSchema: {
      previousStatus: field('string', false, 'Status anterior.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.automations.automation.paused',
    description: 'Automação pausada.',
    requiredContext: ['automationId'],
    payloadSchema: {
      reason: field('string', false, 'Motivo da pausa.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.automations.automation.published',
    description: 'Versão da automação publicada.',
    requiredContext: ['automationId'],
    payloadSchema: {
      versionId: field('string', true, 'Versão publicada.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.automations.runtime.config.updated',
    description:
      'Runtime contract de automações regenerado para o contexto (secrets sempre mascarados).',
    payloadSchema: {
      configVersion: field('number', false, 'Versão do contrato gerado.'),
    },
  }),

  // ── Automations (execução futura — planejada, nunca emitida neste sprint) ─
  buildEvent({
    eventName: 'leadflow.automations.execution.eligible',
    description:
      'PLANEJADO: automação elegível para executar após um evento gatilho. Sem executor neste sprint.',
    requiredContext: ['automationId'],
    payloadSchema: {
      executionId: field('string', true, 'Id da execução candidata.'),
      triggerEventName: field('string', false, 'Evento que tornou elegível.'),
    },
    status: LeadFlowEventStatus.Planned,
  }),
  buildEvent({
    eventName: 'leadflow.automations.execution.started',
    description:
      'PLANEJADO: execução de automação iniciada por runtime futuro.',
    requiredContext: ['automationId'],
    payloadSchema: {
      executionId: field('string', true, 'Id da execução.'),
    },
    status: LeadFlowEventStatus.Planned,
  }),
  buildEvent({
    eventName: 'leadflow.automations.execution.completed',
    description: 'PLANEJADO: execução de automação concluída com sucesso.',
    requiredContext: ['automationId'],
    payloadSchema: {
      executionId: field('string', true, 'Id da execução.'),
    },
    status: LeadFlowEventStatus.Planned,
  }),
  buildEvent({
    eventName: 'leadflow.automations.execution.failed',
    description: 'PLANEJADO: execução de automação falhou.',
    requiredContext: ['automationId'],
    payloadSchema: {
      executionId: field('string', true, 'Id da execução.'),
      errorCode: field('string', false, 'Código de erro resumido.'),
    },
    status: LeadFlowEventStatus.Planned,
  }),
  buildEvent({
    eventName: 'leadflow.automations.execution.skipped',
    description:
      'PLANEJADO: execução pulada (condições não atendidas, cooldown, handoff...).',
    requiredContext: ['automationId'],
    payloadSchema: {
      executionId: field('string', true, 'Id da execução.'),
      skipReason: field('string', false, 'Motivo do skip.'),
    },
    status: LeadFlowEventStatus.Planned,
  }),

  // ── Calendar / Agenda (app opcional premium) ─────────────────────────────
  buildEvent({
    eventName: 'leadflow.calendar.appointment.created',
    description: 'Agendamento criado na Agenda do LeadFlow.',
    requiredContext: ['appointmentId'],
    payloadSchema: {
      startsAt: field('string', true, 'ISO do início do agendamento.'),
      serviceRef: field('string', false, 'Serviço/procedimento agendado.'),
      channel: field('string', false, 'Canal de origem do agendamento.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.calendar.appointment.updated',
    description: 'Agendamento atualizado (horário, serviço, observações).',
    requiredContext: ['appointmentId'],
    payloadSchema: CHANGED_FIELDS,
  }),
  buildEvent({
    eventName: 'leadflow.calendar.appointment.confirmed',
    description: 'Agendamento confirmado pelo contato.',
    requiredContext: ['appointmentId'],
    payloadSchema: {
      confirmedVia: field('string', false, 'Canal da confirmação.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.calendar.appointment.cancelled',
    description: 'Agendamento cancelado.',
    requiredContext: ['appointmentId'],
    payloadSchema: {
      cancelReason: field('string', false, 'Motivo do cancelamento.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.calendar.appointment.no_show',
    description: 'Contato não compareceu ao agendamento.',
    requiredContext: ['appointmentId'],
    payloadSchema: {
      detectedAt: field('string', true, 'ISO da detecção do no-show.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.calendar.appointment.completed',
    description: 'Agendamento concluído/atendido.',
    requiredContext: ['appointmentId'],
    payloadSchema: {
      completedAt: field('string', true, 'ISO da conclusão.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.calendar.appointment.reminder_due',
    description:
      'Janela de lembrete do agendamento atingida. Emitido por scheduler futuro — nenhum agendador roda neste sprint.',
    requiredContext: ['appointmentId'],
    payloadSchema: {
      startsAt: field('string', true, 'ISO do início do agendamento.'),
      reminderOffsetMinutes: field(
        'number',
        true,
        'Minutos de antecedência do lembrete.',
      ),
    },
  }),

  // ── Settings ─────────────────────────────────────────────────────────────
  buildEvent({
    eventName: 'leadflow.settings.business_mode.changed',
    description: 'Business Mode do contexto LeadFlow alterado.',
    requiredContext: ['leadflowSettingsId'],
    payloadSchema: {
      fromBusinessModeKey: field('string', false, 'Modo anterior.'),
      toBusinessModeKey: field('string', true, 'Novo modo.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.settings.client_prompt_config.updated',
    description:
      'Configuração de prompt do cliente atualizada. Carrega apenas versão e seções alteradas — o prompt bruto NUNCA entra no evento.',
    requiredContext: ['leadflowSettingsId'],
    payloadSchema: {
      configVersion: field('number', false, 'Versão da configuração.'),
      changedSections: field(
        'array',
        true,
        'Seções alteradas (nomes, nunca o conteúdo).',
      ),
    },
    sensitive: true,
  }),
  buildEvent({
    eventName: 'leadflow.settings.integration.enabled',
    description:
      'Integração habilitada no contexto. Apenas a key da integração — tokens e credenciais nunca entram no evento.',
    requiredContext: ['leadflowSettingsId'],
    payloadSchema: {
      integrationKey: field('string', true, 'Key da integração (whatsapp...).'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.settings.integration.disabled',
    description: 'Integração desabilitada no contexto.',
    requiredContext: ['leadflowSettingsId'],
    payloadSchema: {
      integrationKey: field('string', true, 'Key da integração.'),
      reason: field('string', false, 'Motivo, se informado.'),
    },
  }),
  buildEvent({
    eventName: 'leadflow.settings.handoff_rules.updated',
    description: 'Regras de handoff humano atualizadas.',
    requiredContext: ['leadflowSettingsId'],
    payloadSchema: CHANGED_FIELDS,
  }),
  buildEvent({
    eventName: 'leadflow.settings.business_hours.updated',
    description: 'Horário comercial do contexto atualizado.',
    requiredContext: ['leadflowSettingsId'],
    payloadSchema: {
      timezone: field('string', false, 'Timezone configurado.'),
      changedFields: CHANGED_FIELDS.changedFields,
    },
  }),
];

const CATALOG_BY_NAME = new Map<string, LeadFlowEventCatalogItem>(
  LEADFLOW_EVENT_CATALOG.map((item) => [item.eventName, item]),
);

export function getEventByName(
  eventName: string,
): LeadFlowEventCatalogItem | undefined {
  return CATALOG_BY_NAME.get(eventName);
}

export function listEvents(filter?: {
  moduleKey?: LeadFlowEventModuleKey;
  status?: LeadFlowEventStatus;
}): LeadFlowEventCatalogItem[] {
  return LEADFLOW_EVENT_CATALOG.filter(
    (item) =>
      (!filter?.moduleKey || item.moduleKey === filter.moduleKey) &&
      (!filter?.status || item.status === filter.status),
  );
}

/**
 * Regra estrutural Inbox → CRM (blueprint section 5). Não é uma automação
 * configurável e a execução NÃO é implementada neste sprint — o contrato
 * apenas prevê os eventos relacionados.
 */
export const LEADFLOW_EVENT_STRUCTURAL_RULE: LeadFlowEventStructuralRule = {
  everyConversationCreatesOpportunity: true,
  description:
    'Toda conversa recebida no Inbox gera ou vincula uma oportunidade no CRM/Leads. Regra estrutural do LeadFlow — não é uma automação configurável e a execução não faz parte deste sprint.',
  relatedEvents: [
    'leadflow.inbox.conversation.created',
    'leadflow.crm.contact.created',
    'leadflow.crm.opportunity.created',
    'leadflow.crm.opportunity.linked_to_conversation',
  ],
};

/**
 * Ponte contratual entre os triggers de Automations e o catálogo de eventos
 * (blueprint section 12). `eventName: null` = trigger ainda sem evento
 * correspondente; a integração é de contrato, nunca de execução.
 */
export const LEADFLOW_AUTOMATION_TRIGGER_EVENT_MAPPINGS: LeadFlowEventTriggerMapping[] =
  [
    {
      trigger: 'conversation.created',
      eventName: 'leadflow.inbox.conversation.created',
      status: 'mapped',
    },
    {
      trigger: 'conversation.idle',
      eventName: 'leadflow.inbox.conversation.idle',
      status: 'mapped',
    },
    {
      trigger: 'conversation.replied',
      eventName: 'leadflow.inbox.conversation.message.received',
      status: 'mapped',
      notes: 'Resposta do lead = mensagem recebida na conversa.',
    },
    {
      trigger: 'conversation.handoff_requested',
      eventName: 'leadflow.inbox.conversation.handoff.requested',
      status: 'mapped',
    },
    {
      trigger: 'opportunity.created',
      eventName: 'leadflow.crm.opportunity.created',
      status: 'mapped',
    },
    {
      trigger: 'opportunity.stage_changed',
      eventName: 'leadflow.crm.opportunity.stage.changed',
      status: 'mapped',
    },
    {
      trigger: 'opportunity.score_changed',
      eventName: 'leadflow.crm.opportunity.score.changed',
      status: 'mapped',
    },
    {
      trigger: 'opportunity.hot_lead_detected',
      eventName: 'leadflow.crm.opportunity.score.changed',
      status: 'mapped',
      notes:
        'Hot lead é derivado de mudança de score acima do limiar configurado.',
    },
    {
      trigger: 'opportunity.missing_fields_detected',
      eventName: null,
      status: 'planned',
      notes: 'Depende de detector futuro de campos obrigatórios.',
    },
    {
      trigger: 'appointment.created',
      eventName: 'leadflow.calendar.appointment.created',
      status: 'mapped',
    },
    {
      trigger: 'appointment.confirmation_pending',
      eventName: null,
      status: 'planned',
      notes: 'Estado derivado; evento próprio ainda não contratado.',
    },
    {
      trigger: 'appointment.no_show',
      eventName: 'leadflow.calendar.appointment.no_show',
      status: 'mapped',
    },
    {
      trigger: 'appointment.completed',
      eventName: 'leadflow.calendar.appointment.completed',
      status: 'mapped',
    },
    {
      trigger: 'quote.sent',
      eventName: null,
      status: 'planned',
      notes: 'Cotações ficam fora do contrato de eventos v1 do LeadFlow.',
    },
    {
      trigger: 'quote.idle',
      eventName: null,
      status: 'planned',
      notes: 'Cotações ficam fora do contrato de eventos v1 do LeadFlow.',
    },
    {
      trigger: 'business_hours.closed',
      eventName: null,
      status: 'planned',
      notes: 'Condição de janela, não um evento de domínio.',
    },
    {
      trigger: 'developer.webhook.received',
      eventName: null,
      status: 'planned',
      notes: 'Evento de ingresso de webhook será contratado com o runtime.',
    },
    {
      trigger: 'schedule.daily',
      eventName: null,
      status: 'planned',
      notes: 'Depende do scheduler futuro.',
    },
    {
      trigger: 'contact.special_date',
      eventName: null,
      status: 'planned',
      notes: 'Depende do scheduler futuro.',
    },
  ];
