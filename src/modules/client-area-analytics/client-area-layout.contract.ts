import { TABLE_SOURCES } from '../../common/analytics-contracts/social-table-sources';
import { BadRequestException } from '@nestjs/common';
import {
  SOCIAL_METRIC_CATALOG,
  metricShape,
} from '../../common/analytics-contracts/social-metric.catalog';
import { parseDashboardCard } from '../../common/analytics-contracts/social-card.contract';
import { ANALYTICS_CHANNEL_IDS } from '../../common/analytics-contracts/social-channels';
import { parseDashboardLayout as parseSocialEnvelope } from '../social-analytics-dashboards/dashboard-layout.contract';
import {
  LEADFLOW_METRIC_CATALOG,
  LEADFLOW_SECTIONS,
} from '../leadflow-analytics/dashboards/leadflow-metric.catalog';
import { parseDashboardLayout as parseLeadFlowLayout } from '../leadflow-analytics/dashboards/dashboard-layout.contract';
import type {
  ClientAreaModuleKey,
  ClientAreaContext,
} from '../client-area/client-area.types';

export type ClientAreaMetric = {
  id: string;
  section: string;
  label: string;
  kind: string;
  unit: string;
  additive: boolean;
  grain: string;
  source: string;
  path: string;
  modules: readonly ClientAreaModuleKey[];
  ownerOnly?: boolean;
  channels?: readonly string[];
};
const lfModules = (
  metric: (typeof LEADFLOW_METRIC_CATALOG)[number],
): ClientAreaModuleKey[] =>
  metric.source === 'commercial' ||
  metric.path.startsWith('leadScore') ||
  metric.section === 'commercial' ||
  metric.section === 'lead_quality'
    ? ['leadflow_crm']
    : metric.id === 'overview.commercial_win_rate'
      ? ['leadflow_crm']
      : ['leadflow_inbox'];
export const CLIENT_AREA_METRICS: readonly ClientAreaMetric[] = [
  ...['projects', 'tasks', 'invoices', 'contract'].map(
    (key): ClientAreaMetric => ({
      id: `agency.${key}`,
      section:
        key === 'projects' || key === 'tasks'
          ? 'agency.projects'
          : 'agency.billing',
      label: {
        projects: 'Projetos',
        tasks: 'Próximas tarefas',
        invoices: 'Faturas',
        contract: 'Contrato vigente',
      }[key]!,
      kind: 'table',
      unit: 'rows',
      additive: false,
      grain: 'agency_client',
      source: `agency.${key}`,
      path: '',
      modules: [
        key === 'projects' || key === 'tasks'
          ? 'agency_projects'
          : 'agency_billing',
      ],
      ownerOnly: key === 'invoices' || key === 'contract',
    }),
  ),
  ...LEADFLOW_METRIC_CATALOG.filter((metric) =>
    LEADFLOW_SECTIONS.some(
      (section) => section.id === metric.section && section.clientVisible,
    ),
  ).map(
    (metric): ClientAreaMetric => ({
      ...metric,
      id: `leadflow.${metric.id}`,
      section: `leadflow.${metric.section}`,
      source: `leadflow.${metric.source}`,
      modules: lfModules(metric),
    }),
  ),
  ...SOCIAL_METRIC_CATALOG.map(
    (metric): ClientAreaMetric => ({
      id: `social.${metric.id}`,
      section: `social.${metric.channels[0]}`,
      channels: metric.channels,
      label: metric.label,
      kind: metricShape(metric) === 'scalar' ? 'kpi' : 'breakdown',
      unit: metric.format,
      additive: metric.additive,
      grain: metric.grain,
      source: `social.${metric.source}`,
      path: metric.id,
      modules: ['social_campaigns'],
    }),
  ),
  ...TABLE_SOURCES.map(
    (source): ClientAreaMetric => ({
      id: `social.table.${source.id}`,
      section: `social.${source.channels[0]}`,
      channels: source.channels,
      label: source.label,
      kind: 'table',
      unit: 'rows',
      additive: false,
      grain: 'source_rows',
      source: 'social.table',
      path: source.id,
      modules: ['social_campaigns'],
    }),
  ),
];
export const CLIENT_AREA_SECTIONS = [
  { id: 'agency.projects', label: 'Projetos', clientVisible: true },
  { id: 'agency.billing', label: 'Faturas e contrato', clientVisible: true },
  ...LEADFLOW_SECTIONS.filter((s) => s.clientVisible).map((s) => ({
    id: `leadflow.${s.id}`,
    label: s.label,
    clientVisible: true,
  })),
  ...ANALYTICS_CHANNEL_IDS.map((id) => ({
    id: `social.${id}`,
    label: id,
    clientVisible: true,
  })),
];
export type ClientAreaCard = {
  id: string;
  kind: string;
  size: { w: number; h: number };
  [key: string]: unknown;
};
export type ClientAreaSection = {
  id: string;
  channel: string;
  title: string;
  description?: string | null;
  hidden?: boolean;
  cards: ClientAreaCard[];
};
export type ClientAreaLayout = { version: 1; sections: ClientAreaSection[] };
export const metricById = (id: string) =>
  CLIENT_AREA_METRICS.find((m) => m.id === id);
export function cardMetricIds(card: ClientAreaCard): string[] {
  if (card.kind === 'group')
    return (card.cards as ClientAreaCard[]).flatMap(cardMetricIds);
  if (card.kind === 'insight') return [];
  return card.kind === 'chart'
    ? (card.metricIds as string[])
    : card.kind === 'funnel' && Array.isArray(card.steps)
      ? card.steps.map((s: { metric: string }) => s.metric)
      : [
          String(
            card.kind === 'table' || card.kind === 'funnel'
              ? card.source
              : card.metric,
          ),
        ];
}
export function metricAvailable(
  context: ClientAreaContext,
  metric: ClientAreaMetric,
): boolean {
  return (
    (!metric.ownerOnly ||
      (context.accountRole ?? context.role) === 'client_owner') &&
    metric.modules.every(
      (key) =>
        context.memberAccess?.[key]?.available &&
        context.memberAccess[key].level,
    )
  );
}
/** Only layout/view configuration is accepted; every card is catalog-checked on the server. */
export function parseClientAreaLayout(raw: unknown): ClientAreaLayout {
  try {
    const envelope = parseSocialEnvelope(
      raw && typeof raw === 'object'
        ? {
            ...raw,
            sections: Array.isArray((raw as ClientAreaLayout).sections)
              ? (raw as ClientAreaLayout).sections.map((s) => ({
                  ...s,
                  channel: 'summary',
                }))
              : undefined,
          }
        : raw,
    );
    const input = raw as ClientAreaLayout;
    const sections = envelope.sections.map((s, index): ClientAreaSection => {
      const channel = input.sections[index].channel;
      if (!CLIENT_AREA_SECTIONS.some((entry) => entry.id === channel))
        throw new Error('Seção não permitida.');
      const parseCard = (
        card: ClientAreaCard,
        group = false,
      ): ClientAreaCard => {
        const base = {
          id: card.id,
          kind: card.kind,
          size: card.size,
          ...(typeof card.title === 'string'
            ? { title: card.title.slice(0, 120) }
            : {}),
          ...(typeof card.description === 'string'
            ? { description: card.description.slice(0, 280) }
            : {}),
        };
        if (card.kind === 'group') {
          if (group) throw new Error('Grupo aninhado.');
          return {
            ...base,
            cards: (card.cards as ClientAreaCard[]).map((c) =>
              parseCard(c, true),
            ),
          };
        }
        if (card.kind === 'insight') {
          if (typeof card.body !== 'string' || card.body.length > 20000)
            throw new Error('Texto inválido.');
          return { ...base, body: card.body };
        }
        const ids = cardMetricIds(card);
        if (!ids.length || ids.some((id) => !metricById(id)))
          throw new Error('Métrica desconhecida.');
        const source = ids[0].split('.')[0];
        if (
          ids.some((id) => id.split('.')[0] !== source) ||
          !channel.startsWith(`${source}.`)
        )
          throw new Error('Origem incompatível.');
        const unprefix = (value: string) => value.slice(source.length + 1);
        const mapped = {
          ...card,
          ...(card.metric !== undefined
            ? { metric: unprefix(card.metric as string) }
            : {}),
          ...(card.metricIds !== undefined
            ? { metricIds: ids.map(unprefix) }
            : {}),
          ...(card.source !== undefined
            ? {
                source: unprefix(card.source as string).replace(/^table\./, ''),
              }
            : {}),
          ...(Array.isArray(card.steps)
            ? {
                steps: card.steps.map((s: { metric: string }) => ({
                  ...s,
                  metric: unprefix(s.metric),
                })),
              }
            : {}),
        };
        if (source === 'leadflow') {
          parseLeadFlowLayout({
            version: 1,
            sections: [
              {
                id: s.id,
                channel: channel.slice(9),
                title: s.title,
                cards: [mapped],
              },
            ],
          });
          return {
            ...base,
            ...Object.fromEntries(
              [
                'metric',
                'metricIds',
                'source',
                'steps',
                'chartType',
                'orientation',
                'render',
                'gridColumn',
                'gridRow',
                'highlighted',
              ]
                .filter((key) => card[key] !== undefined)
                .map((key) => [
                  key,
                  key === 'steps' && Array.isArray(card.steps)
                    ? card.steps.map(
                        (step: { metric: string; label?: string }) => ({
                          metric: step.metric,
                          label: step.label,
                        }),
                      )
                    : card[key],
                ]),
            ),
          };
        }
        if (source === 'social') {
          for (const id of ids) {
            const metric = metricById(id)!;
            const dataChannel =
              typeof card.channel === 'string'
                ? card.channel
                : channel.slice(7);
            if (
              metric.channels &&
              !metric.channels.some((c) => c === dataChannel)
            )
              throw new Error('Canal Social incompatível.');
            if (
              card.kind === 'table'
                ? metric.kind !== 'table'
                : card.kind === 'breakdown'
                  ? metric.kind !== 'breakdown'
                  : metric.kind !== 'kpi'
            )
              throw new Error('Tipo de card incompatível.');
          }
          const parsed = parseDashboardCard(
            mapped as Parameters<typeof parseDashboardCard>[0],
          );
          if (!parsed) throw new Error('Card Social inválido.');
          return {
            ...parsed,
            id: card.id,
            size: card.size,
            ...(card.metric !== undefined ? { metric: card.metric } : {}),
            ...(card.metricIds !== undefined
              ? { metricIds: card.metricIds }
              : {}),
            ...(card.source !== undefined ? { source: card.source } : {}),
            ...(parsed.kind === 'funnel'
              ? {
                  steps: parsed.steps.map((step) => ({
                    ...step,
                    metric: `social.${step.metric}`,
                  })),
                }
              : {}),
          };
        }
        if (
          card.kind !== 'table' ||
          ids.length !== 1 ||
          metricById(ids[0])?.section !== channel
        )
          throw new Error('Card Agency inválido.');
        return { ...base, source: ids[0] };
      };
      return {
        id: s.id,
        channel,
        title: s.title,
        ...(s.description !== undefined ? { description: s.description } : {}),
        ...(input.sections[index].hidden === true ? { hidden: true } : {}),
        cards: (s.cards as ClientAreaCard[]).map((c) => parseCard(c)),
      };
    });
    return { version: 1, sections };
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : 'Layout inválido.',
    );
  }
}
export function defaultClientAreaLayout(
  products: readonly string[],
): ClientAreaLayout {
  const sections: ClientAreaSection[] = [
    {
      id: 'seed-agency-projects',
      channel: 'agency.projects',
      title: 'Projetos',
      cards: [
        {
          id: 'projects',
          kind: 'table',
          size: { w: 12, h: 4 },
          source: 'agency.projects',
        },
        {
          id: 'tasks',
          kind: 'table',
          size: { w: 12, h: 4 },
          source: 'agency.tasks',
        },
      ],
    },
    {
      id: 'seed-agency-billing',
      channel: 'agency.billing',
      title: 'Faturas e contrato',
      cards: [
        {
          id: 'invoices',
          kind: 'table',
          size: { w: 12, h: 4 },
          source: 'agency.invoices',
        },
        {
          id: 'contract',
          kind: 'table',
          size: { w: 12, h: 4 },
          source: 'agency.contract',
        },
      ],
    },
  ];
  if (products.includes('leadflow'))
    sections.push({
      id: 'seed-leadflow',
      channel: 'leadflow.overview',
      title: 'LeadFlow',
      cards: LEADFLOW_METRIC_CATALOG.filter(
        (m) => m.section === 'overview' && m.kind === 'kpi',
      ).map((m, index) => ({
        id: `lf-${index}`,
        kind: 'kpi',
        size: { w: 2, h: 1 },
        metric: `leadflow.${m.id}`,
      })),
    });
  if (products.includes('social'))
    sections.push({
      id: 'seed-social',
      channel: 'social.summary',
      title: 'Social',
      cards: ['summary_spend', 'summary_impressions', 'summary_engagement'].map(
        (id, index) => ({
          id: `social-${index}`,
          kind: 'kpi',
          size: { w: 2, h: 1 },
          metric: `social.${id}`,
        }),
      ),
    });
  return { version: 1, sections };
}
