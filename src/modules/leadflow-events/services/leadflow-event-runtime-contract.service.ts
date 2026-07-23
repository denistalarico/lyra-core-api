import { Injectable } from '@nestjs/common';
import {
  LEADFLOW_AUTOMATION_TRIGGER_EVENT_MAPPINGS,
  LEADFLOW_EVENT_STRUCTURAL_RULE,
  listEvents,
} from '../catalog/leadflow-event.catalog';
import type {
  LeadFlowEventEnvelopeFieldSpec,
  LeadFlowEventRuntimeContract,
  LeadFlowEventSensitiveDataPolicy,
} from '../types/leadflow-event.types';
import { LEADFLOW_EVENT_PRODUCT_KEY } from '../types/leadflow-event.types';

export const LEADFLOW_EVENT_CONTRACT_VERSION = 1;

/** Envelope contract, field by field (blueprint sections 6 and 7). */
const ENVELOPE_SCHEMA: LeadFlowEventEnvelopeFieldSpec[] = [
  {
    field: 'eventId',
    type: 'string (uuid)',
    required: true,
    description: 'Identificador único do evento.',
  },
  {
    field: 'eventName',
    type: 'string',
    required: true,
    description:
      'Nome estável no padrão leadflow.<module>.<resource>.<action>.',
  },
  {
    field: 'eventVersion',
    type: 'number',
    required: true,
    description:
      'Versão do contrato do evento; mudanças incompatíveis criam nova versão.',
  },
  {
    field: 'occurredAt',
    type: 'string (ISO 8601)',
    required: true,
    description: 'Instante em que o fato ocorreu.',
  },
  {
    field: 'tenantId',
    type: 'string (uuid)',
    required: true,
    description: 'Tenant dono do evento.',
  },
  {
    field: 'workspaceId',
    type: 'string (uuid)',
    required: true,
    description: 'Workspace do evento.',
  },
  {
    field: 'productKey',
    type: "'leadflow'",
    required: true,
    description: 'Sempre leadflow neste contrato.',
  },
  {
    field: 'moduleKey',
    type: 'string',
    required: true,
    description: 'Módulo emissor (leadflow.inbox, leadflow.crm...).',
  },
  {
    field: 'source',
    type: 'object { module, entityType, entityId }',
    required: true,
    description: 'Entidade que originou o evento.',
  },
  {
    field: 'actor',
    type: 'object { type, id?, displayName? }',
    required: false,
    description:
      'Quem causou o evento (user, agent, system, contact, external).',
  },
  {
    field: 'correlation',
    type: 'object { correlationId, causationId?, sourceEventId? }',
    required: true,
    description: 'Cadeia de correlação para rastreio e deduplicação futura.',
  },
  {
    field: 'context',
    type: 'object (ids LeadFlow)',
    required: false,
    description:
      'Ids de contexto (conversationId, opportunityId...); o catálogo define os obrigatórios por evento.',
  },
  {
    field: 'payload',
    type: 'object (JSON)',
    required: true,
    description: 'Dados mínimos do evento conforme payloadSchema do catálogo.',
  },
  {
    field: 'metadata',
    type: 'object { schemaVersion, dedupeKey?, sensitive? }',
    required: true,
    description: 'Metadados de versionamento, dedupe e sensibilidade.',
  },
];

/** Blueprint section 14 — what events must never carry. */
const SENSITIVE_DATA_POLICY: LeadFlowEventSensitiveDataPolicy = {
  forbidden: [
    'tokens',
    'secrets',
    'credenciais de webhook ou payload bruto de webhook',
    'prompt bruto',
    'mensagens completas quando não forem necessárias',
    'dados sensíveis desnecessários',
  ],
  guidance: [
    'Prefira ids e referências a objetos completos.',
    'Use resumo e metadados mínimos no lugar de conteúdo integral.',
    'Marque metadata.sensitive=true quando o evento referenciar conteúdo sensível.',
    'Aplique mascaramento antes de qualquer log futuro.',
  ],
};

/**
 * Builds the LeadFlow event runtime contract (blueprint section 11). Building
 * this response is pure; delivery is implemented by durable, consumer-specific
 * fan-out.
 */
@Injectable()
export class LeadFlowEventRuntimeContractService {
  buildRuntimeContract(): LeadFlowEventRuntimeContract {
    return {
      productKey: LEADFLOW_EVENT_PRODUCT_KEY,
      version: LEADFLOW_EVENT_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      namingConvention: 'leadflow.<module>.<resource>.<action>',
      envelopeSchema: ENVELOPE_SCHEMA,
      catalog: listEvents(),
      structuralRules: LEADFLOW_EVENT_STRUCTURAL_RULE,
      automationTriggerMappings: LEADFLOW_AUTOMATION_TRIGGER_EVENT_MAPPINGS,
      sensitiveDataPolicy: SENSITIVE_DATA_POLICY,
      unsupportedExecutionNotice: {
        message:
          'Eventos canônicos possuem persistência e fan-out durável para Automations. Avaliação de receitas e efeitos automáticos continuam desabilitados.',
        eventBus: true,
        persistence: true,
        execution: false,
        redis: false,
        temporal: false,
        n8n: false,
        llm: false,
      },
    };
  }
}
