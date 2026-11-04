import { projectOperationalAnalytics } from '../services/operational-analytics-projector';
import { projectCommercialJourney } from '../services/commercial-journey-projector';
import {
  DASHBOARD_CHANNEL_IDS,
  normalizeLeadFlowLayout,
  parseDashboardLayout,
} from './dashboard-layout.contract';
import {
  LEADFLOW_METRIC_CATALOG,
  LEADFLOW_SECTIONS,
} from './leadflow-metric.catalog';

describe('CA12 LeadFlow canvas contract', () => {
  it('maps every canonical operational/commercial summary field without changing formulas', () => {
    const from = new Date('2026-07-01');
    const to = new Date('2026-07-02');
    const operational = projectOperationalAnalytics({
      from,
      to,
      filters: { channelId: null, businessMode: null, agentId: null },
      options: { channels: [], businessModes: [], agents: [] },
      messages: [],
      scores: [],
      runs: [],
      attempts: [],
      agentNames: new Map(),
    });
    const commercial = projectCommercialJourney({
      from,
      to,
      opportunities: [],
      opportunityEvents: [],
      conversationEvents: [],
      pipelineNames: new Map(),
      stageNames: new Map(),
    });
    for (const domain of ['messages', 'leadScore', 'automations'] as const) {
      for (const field of Object.keys(operational[domain].summary))
        expect(
          LEADFLOW_METRIC_CATALOG.some(
            (metric) =>
              metric.source === 'operational' &&
              metric.path === `${domain}.summary.${field}`,
          ),
        ).toBe(true);
    }
    for (const field of Object.keys(commercial.summary))
      expect(
        LEADFLOW_METRIC_CATALOG.some(
          (metric) =>
            metric.source === 'commercial' &&
            metric.path === `summary.${field}`,
        ),
      ).toBe(true);
    expect(
      LEADFLOW_METRIC_CATALOG.find(
        (metric) => metric.id === 'messages.leadRepliesAfterFirstAgentReply',
      )?.additive,
    ).toBe(false);
  });
  it('preserves groups and frozen insight bodies and rejects nested groups/bad bodies', () => {
    const insight = {
      id: 'insight',
      title: 'Análise',
      kind: 'insight',
      body: 'Leitura persistida',
      size: { w: 6, h: 3 },
    };
    const group = {
      id: 'group',
      title: 'Grupo',
      kind: 'group',
      size: { w: 10, h: 3 },
      cards: [insight],
    };
    const layout = (card: unknown) => ({
      version: 1,
      sections: [
        {
          id: 'overview',
          channel: 'overview',
          title: 'Visão geral',
          cards: [card],
        },
      ],
    });
    expect(parseDashboardLayout(layout(group)).sections[0].cards[0]).toEqual(
      group,
    );
    expect(() =>
      parseDashboardLayout(layout({ ...group, cards: [group] })),
    ).toThrow();
    expect(() =>
      parseDashboardLayout(layout({ ...insight, body: {} })),
    ).toThrow();
  });
  it('exports six product sections and keeps data quality Agency-only', () => {
    expect(DASHBOARD_CHANNEL_IDS).toEqual([
      'overview',
      'service',
      'commercial',
      'lead_quality',
      'automations',
      'recommendations',
    ]);
    expect(
      LEADFLOW_SECTIONS.filter((s) => !s.clientVisible).map((s) => s.id),
    ).toEqual(['data_quality']);
    expect(new Set(LEADFLOW_METRIC_CATALOG.map((m) => m.id)).size).toBe(
      LEADFLOW_METRIC_CATALOG.length,
    );
    for (const metric of LEADFLOW_METRIC_CATALOG) {
      expect(metric.unit).toBeTruthy();
      expect(typeof metric.additive).toBe('boolean');
      expect(metric.grain).toBeTruthy();
    }
    expect(LEADFLOW_SECTIONS[0].label).toBe('Resumo');
    expect(
      LEADFLOW_METRIC_CATALOG.find(
        (metric) => metric.id === 'commercial.stages',
      )?.kind,
    ).toBe('funnel');
    expect(
      LEADFLOW_METRIC_CATALOG.find(
        (metric) => metric.id === 'commercial.funnel',
      )?.kind,
    ).toBe('comparison');
    expect(
      LEADFLOW_METRIC_CATALOG.find(
        (metric) => metric.id === 'leadScore.distribution',
      ),
    ).toMatchObject({ label: 'Lead Score', kind: 'funnel' });
  });
  it('round-trips valid KPI layout and rejects unknown section, metric, duplicate and oversized cards', () => {
    const card = {
      id: 'a',
      kind: 'kpi',
      metric: 'messages.inbound',
      title: 'Entradas',
      size: { w: 2, h: 1 },
    };
    const layout = {
      version: 1,
      sections: [
        {
          id: 'service',
          channel: 'service',
          title: 'Atendimento',
          cards: [card],
        },
      ],
    };
    expect(parseDashboardLayout(layout)).toEqual(layout);
    const withCards = (cards: unknown[]) => ({
      ...layout,
      sections: [{ ...layout.sections[0], cards }],
    });
    expect(() =>
      parseDashboardLayout(withCards([{ ...card, metric: 'secret' }])),
    ).toThrow();
    expect(() => parseDashboardLayout(withCards([card, card]))).toThrow();
    expect(() =>
      parseDashboardLayout(withCards([{ ...card, title: {} }])),
    ).toThrow();
    expect(() =>
      parseDashboardLayout(withCards([{ ...card, size: { w: 13, h: 1 } }])),
    ).toThrow();
    expect(() =>
      parseDashboardLayout({
        ...layout,
        sections: [{ ...layout.sections[0], channel: 'facebook' }],
      }),
    ).toThrow();
  });
  it('accepts card presentation options and normalizes legacy visual card kinds', () => {
    const legacy = {
      version: 1,
      sections: [
        {
          id: 'commercial',
          channel: 'commercial',
          title: 'Comercial',
          cards: [
            {
              id: 'commercial.stages',
              kind: 'table',
              source: 'commercial.stages',
              title: 'Etapas',
              description: null,
              size: { w: 10, h: 5 },
            },
            {
              id: 'commercial.funnel',
              kind: 'funnel',
              source: 'commercial.funnel',
              title: 'Oportunidades → ganhas',
              description: null,
              orientation: 'horizontal',
              size: { w: 10, h: 5 },
            },
          ],
        },
      ],
    };
    const normalized = normalizeLeadFlowLayout(legacy);
    expect(normalized.sections[0].cards).toEqual([
      expect.objectContaining({ kind: 'funnel', source: 'commercial.stages' }),
      expect.objectContaining({
        kind: 'comparison',
        metric: 'commercial.funnel',
      }),
    ]);
    const funnel = normalized.sections[0].cards[0];
    const parsed = parseDashboardLayout({
      ...normalized,
      sections: [
        {
          ...normalized.sections[0],
          cards: [
            {
              ...funnel,
              decimals: 1,
              display: 'percent',
              steps: [{ id: 'stage-new', metric: 'Novo', label: 'Novos' }],
            },
          ],
        },
      ],
    });
    expect(parsed.sections[0].cards[0]).toMatchObject({
      decimals: 1,
      display: 'percent',
      steps: [{ id: 'stage-new', metric: 'Novo', label: 'Novos' }],
    });
    expect(() =>
      parseDashboardLayout({
        ...normalized,
        sections: [
          {
            ...normalized.sections[0],
            cards: [
              {
                ...funnel,
                steps: [
                  { id: 'duplicated', metric: 'Novo', label: 'Novos' },
                  {
                    id: 'duplicated',
                    metric: 'Qualificado',
                    label: 'Qualificados',
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow('Há etapas repetidas no funil.');
  });
});
