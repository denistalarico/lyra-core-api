import { LEADFLOW_AGENTS_PERMISSIONS } from '../../leadflow-agents/leadflow-agents.permissions';
import { LEADFLOW_ANALYTICS_PERMISSIONS } from '../../leadflow-analytics/leadflow-analytics.permissions';
import type { OrionToolDefinition } from '../orion.provider';
import type { OrionToolRequirement } from './orion-tool-access.service';
import { ORION_DAYS, ORION_PERIODS } from './orion-period';

export const ORION_TOOL_NAMES = [
  'search_help',
  'leadflow_operational_overview',
  'leadflow_commercial_journey',
  'list_agents',
  'crm_pipeline_snapshot',
  'agenda_for_day',
  'ui_action',
] as const;
export type OrionToolName = (typeof ORION_TOOL_NAMES)[number];

export type OrionToolSpec = {
  name: OrionToolName;
  description: string;
  parameters: Record<string, unknown>;
  /** `null`: no permission (platform help, client-side UI action). */
  requirement: OrionToolRequirement | null;
  /** Whether the tool exists for the Client Area principal at all. */
  clientArea: boolean;
};

const period = {
  type: 'string',
  enum: [...ORION_PERIODS],
  description:
    'Período no fuso da empresa. Use "today" quando o usuário não disser.',
};

const noArguments = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

const ANALYTICS_KEYS = [
  LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
  LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
] as const;

/**
 * OR4 — the Orion's read tools (§3.3). Static on purpose: the provider
 * receives the same list for every caller of a surface, so it stays in the
 * cached prompt prefix; permission is decided when a tool runs.
 *
 * No tool takes a tenant, workspace, client, company or user argument
 * (§3.5 item 2): scope comes from the caller's request context only.
 *
 * Each requirement mirrors the equivalent read route — its keys on the
 * Agency side and its exposure (module, key, route) on the Client Area
 * bridge. A tool without a bridge route is not offered to the client.
 */
export const ORION_TOOL_CATALOG: readonly OrionToolSpec[] = [
  {
    name: 'search_help',
    description:
      'Busca artigos da Central de Ajuda do Lyra (como fazer algo, onde ' +
      'configurar). Devolve título, trecho e rota.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A pergunta do usuário em poucas palavras.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    requirement: null,
    clientArea: true,
  },
  {
    name: 'leadflow_operational_overview',
    description:
      'KPIs operacionais do LeadFlow no período: mensagens, conversas, taxa ' +
      'e tempo de resposta, por canal e por agente.',
    parameters: {
      type: 'object',
      properties: { period },
      required: ['period'],
      additionalProperties: false,
    },
    requirement: {
      agency: {
        anyOf: ANALYTICS_KEYS,
        routePath: '/leadflow/analytics/operational-overview',
      },
      clientArea: {
        module: 'leadflow_agents',
        key: LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
        routePath: '/leadflow/analytics/operational-overview',
      },
    },
    clientArea: true,
  },
  {
    name: 'leadflow_commercial_journey',
    description:
      'Jornada comercial do período: oportunidades criadas, ganhas, perdidas, ' +
      'handoffs, influência da IA e o funil por etapa.',
    parameters: {
      type: 'object',
      properties: { period },
      required: ['period'],
      additionalProperties: false,
    },
    requirement: {
      agency: {
        anyOf: ANALYTICS_KEYS,
        routePath: '/leadflow/analytics/commercial-journey',
      },
      clientArea: {
        module: 'leadflow_agents',
        key: LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
        routePath: '/leadflow/analytics/commercial-journey',
      },
    },
    clientArea: true,
  },
  {
    name: 'list_agents',
    description:
      'Agentes do LeadFlow visíveis: nome, tipo, status, prontidão e canais.',
    parameters: noArguments,
    requirement: {
      agency: {
        anyOf: [LEADFLOW_AGENTS_PERMISSIONS.view],
        routePath: '/leadflow/agents',
      },
      clientArea: {
        module: 'leadflow_agents',
        key: LEADFLOW_AGENTS_PERMISSIONS.view,
        routePath: '/leadflow/agents',
      },
    },
    clientArea: true,
  },
  {
    name: 'crm_pipeline_snapshot',
    description:
      'Foto atual do CRM: funis e quantas oportunidades abertas há em cada etapa.',
    parameters: noArguments,
    requirement: {
      agency: {
        anyOf: ['leadflow.crm.records.view.client'],
        routePath: '/crm/opportunities',
      },
      clientArea: {
        module: 'leadflow_crm',
        key: 'leadflow.crm.records.view.client',
        routePath: '/crm/opportunities',
      },
    },
    clientArea: true,
  },
  {
    name: 'agenda_for_day',
    description:
      'Compromissos da agenda do LeadFlow (reuniões, chamadas, eventos) de hoje ou amanhã.',
    parameters: {
      type: 'object',
      properties: {
        day: {
          type: 'string',
          enum: [...ORION_DAYS],
          description: 'Dia no fuso da empresa.',
        },
      },
      required: ['day'],
      additionalProperties: false,
    },
    requirement: {
      // Only the company-wide key: a user limited to `view.assigned` would
      // see every appointment through a list the Orion summarizes.
      agency: {
        anyOf: ['leadflow.appointments.item.view.client'],
        routePath: '/leadflow/agenda/v1/appointments',
      },
      clientArea: {
        module: 'leadflow_appointments',
        key: 'leadflow.appointments.item.view.client',
        routePath: '/leadflow/agenda/v1/appointments',
      },
    },
    clientArea: true,
  },
  {
    name: 'ui_action',
    description:
      'Executa uma ação de interface no navegador do usuário: trocar o tema ' +
      '(light, dark, system) ou abrir uma página da lista de rotas do manifesto.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['set_theme', 'navigate'] },
        value: {
          type: 'string',
          description: 'Tema (light, dark, system) ou rota exata do manifesto.',
        },
      },
      required: ['action', 'value'],
      additionalProperties: false,
    },
    requirement: null,
    clientArea: true,
  },
];

export function orionToolDefinitions(
  principal: 'agency' | 'client_area',
): OrionToolDefinition[] {
  return ORION_TOOL_CATALOG.filter(
    (tool) => principal === 'agency' || tool.clientArea,
  ).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
