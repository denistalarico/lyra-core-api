import { projectCommercialJourney } from './commercial-journey-projector';
import { LeadFlowAnalyticsReportService } from './leadflow-analytics-report.service';
import { projectOperationalAnalytics } from './operational-analytics-projector';

const from = new Date('2026-07-01T00:00:00.000Z');
const to = new Date('2026-07-30T23:59:59.000Z');
const ctx = { tenantId: 'tenant', workspaceId: 'workspace' };

function harness() {
  const commercialResult = projectCommercialJourney({
    from,
    to,
    opportunities: [],
    opportunityEvents: [],
    conversationEvents: [],
    pipelineNames: new Map(),
    stageNames: new Map(),
  });
  const operationalResult = projectOperationalAnalytics({
    from,
    to,
    filters: {
      channelId: null,
      businessMode: null,
      agentId: null,
    },
    options: { channels: [], businessModes: [], agents: [] },
    messages: [],
    scores: [],
    runs: [],
    attempts: [],
    agentNames: new Map(),
  });
  const commercial = {
    getCommercialJourney: jest.fn().mockResolvedValue(commercialResult),
  };
  const operational = {
    getOverview: jest.fn().mockResolvedValue(operationalResult),
  };
  const pdf = {
    renderHtmlToPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')),
  };
  return {
    service: new LeadFlowAnalyticsReportService(
      commercial as never,
      operational as never,
      pdf as never,
    ),
    commercial,
    operational,
    pdf,
  };
}

describe('LeadFlowAnalyticsReportService', () => {
  it('combines both canonical projections for an overview PDF', async () => {
    const h = harness();
    const result = await h.service.renderPdf(ctx, {
      from: from.toISOString(),
      to: to.toISOString(),
      reportType: 'overview',
    });

    expect(h.commercial.getCommercialJourney).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ reportType: 'overview' }),
    );
    expect(h.operational.getOverview).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ reportType: 'overview' }),
    );
    expect(h.pdf.renderHtmlToPdf).toHaveBeenCalledWith(
      expect.stringContaining('Resumo executivo'),
      expect.objectContaining({ format: 'A4' }),
    );
    expect(result.filename).toBe('leadflow-overview-2026-07-01-2026-07-30.pdf');
    expect(result.buffer).toEqual(Buffer.from('pdf'));
  });

  it('does not load operational facts for a commercial-only PDF', async () => {
    const h = harness();
    await h.service.renderPdf(ctx, {
      from: from.toISOString(),
      to: to.toISOString(),
      reportType: 'commercial',
    });

    expect(h.commercial.getCommercialJourney).toHaveBeenCalledTimes(1);
    expect(h.operational.getOverview).not.toHaveBeenCalled();
  });
});
