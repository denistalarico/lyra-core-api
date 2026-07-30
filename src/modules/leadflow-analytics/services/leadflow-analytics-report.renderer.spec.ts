import { projectCommercialJourney } from './commercial-journey-projector';
import { buildLeadFlowAnalyticsReportHtml } from './leadflow-analytics-report.renderer';
import { projectOperationalAnalytics } from './operational-analytics-projector';

const from = new Date('2026-07-01T00:00:00.000Z');
const to = new Date('2026-07-30T23:59:59.000Z');

function commercialReport() {
  return projectCommercialJourney({
    from,
    to,
    opportunities: [],
    opportunityEvents: [],
    conversationEvents: [],
    pipelineNames: new Map(),
    stageNames: new Map(),
  });
}

function operationalReport() {
  return projectOperationalAnalytics({
    from,
    to,
    filters: {
      channelId: null,
      businessMode: null,
      agentId: null,
    },
    options: {
      channels: [],
      businessModes: [],
      agents: [],
    },
    messages: [],
    scores: [],
    runs: [],
    attempts: [],
    agentNames: new Map(),
  });
}

describe('buildLeadFlowAnalyticsReportHtml', () => {
  it('renders the real overview sources and escapes a custom title', () => {
    const html = buildLeadFlowAnalyticsReportHtml({
      reportType: 'overview',
      title: '<script>alert("x")</script>',
      commercial: commercialReport(),
      operational: operationalReport(),
      generatedAt: new Date('2026-07-30T15:00:00.000Z'),
    });

    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('Resumo executivo');
    expect(html).toContain('Jornada comercial');
    expect(html).toContain('Conversas e atendimento');
    expect(html).toContain('Lead Score');
    expect(html).toContain('Automações');
    expect(html).toContain('não contém conteúdo de mensagens');
  });

  it('keeps a focused automation report free of commercial sections', () => {
    const html = buildLeadFlowAnalyticsReportHtml({
      reportType: 'automations',
      commercial: null,
      operational: operationalReport(),
      generatedAt: new Date('2026-07-30T15:00:00.000Z'),
    });

    expect(html).toContain('LeadFlow · Automações');
    expect(html).toContain('<h2>Automações</h2>');
    expect(html).not.toContain('<h2>Jornada comercial</h2>');
    expect(html).not.toContain('<h2>Conversas e atendimento</h2>');
  });
});
