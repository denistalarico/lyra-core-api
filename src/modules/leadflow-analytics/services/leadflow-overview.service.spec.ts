import { BadRequestException } from '@nestjs/common';
import { LeadFlowOverviewService } from './leadflow-overview.service';

function operationalFixture(overrides?: {
  messages?: Partial<{
    inboundConversations: number;
    respondedConversations: number;
    firstResponseRate: number;
    averageFirstResponseSeconds: number;
    failedOutbound: number;
  }>;
  automations?: Partial<{
    runs: number;
    succeeded: number;
    failed: number;
    successRate: number;
  }>;
  hotTransitions?: number;
}) {
  return {
    messages: {
      summary: {
        inboundConversations: 10,
        respondedConversations: 8,
        firstResponseRate: 0.8,
        averageFirstResponseSeconds: 120,
        failedOutbound: 0,
        ...overrides?.messages,
      },
    },
    leadScore: {
      summary: {
        hotTransitions: overrides?.hotTransitions ?? 0,
      },
    },
    automations: {
      summary: {
        runs: 5,
        succeeded: 4,
        failed: 1,
        successRate: 0.8,
        ...overrides?.automations,
      },
    },
  };
}

function commercialFixture(overrides?: {
  summary?: Partial<{ opportunities: number; won: number; winRate: number }>;
  dataQuality?: Partial<{
    missingCreationFacts: number;
    legacyJourneyFallbacks: number;
  }>;
}) {
  return {
    summary: {
      opportunities: 20,
      won: 5,
      winRate: 0.25,
      ...overrides?.summary,
    },
    dataQuality: {
      missingCreationFacts: 0,
      legacyJourneyFallbacks: 0,
      ...overrides?.dataQuality,
    },
  };
}

function whatsappChannel(overrides?: {
  state?:
    | 'not_connected'
    | 'connecting'
    | 'connected'
    | 'failed'
    | 'needs_action';
  metadata?: Record<string, unknown>;
}) {
  return {
    state: overrides?.state ?? 'connected',
    metadata: overrides?.metadata ?? {},
  };
}

function harness() {
  const getOverview = jest.fn().mockResolvedValue(operationalFixture());
  const getCommercialJourney = jest.fn().mockResolvedValue(commercialFixture());
  const listStatus = jest.fn().mockResolvedValue({
    state: 'connected',
    primaryChannel: null,
    channels: [whatsappChannel()],
  });
  const getCapacity = jest.fn().mockResolvedValue({
    activeCompanies: 1,
    limit: null,
    availableSlots: null,
    planKey: null,
    entitlementStatus: null,
  });

  const service = new LeadFlowOverviewService(
    { getOverview } as never,
    { getCommercialJourney } as never,
    { listStatus } as never,
    { getCapacity } as never,
  );

  return {
    service,
    getOverview,
    getCommercialJourney,
    listStatus,
    getCapacity,
  };
}

const agencyCtx = { tenantId: 'tenant-1', workspaceId: 'workspace-1' };
const clientCtx = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  managedContext: {
    productKey: 'leadflow' as const,
    operatingMode: 'client' as const,
    clientId: 'client-1',
    managedTenantId: null,
  },
};

describe('LeadFlowOverviewService', () => {
  it('returns exactly five KPIs with formula/source/window/limitation and reuses the existing analytics endpoints', async () => {
    const h = harness();

    const result = await h.service.getOverview(agencyCtx, {});

    expect(result.kpis).toHaveLength(5);
    expect(result.kpis.map((kpi) => kpi.key)).toEqual([
      'first_response_rate',
      'first_response_time_seconds',
      'hot_lead_transitions',
      'commercial_win_rate',
      'automation_success_rate',
    ]);
    for (const kpi of result.kpis) {
      expect(kpi.formula.length).toBeGreaterThan(0);
      expect(kpi.source.length).toBeGreaterThan(0);
      expect(kpi.limitation.length).toBeGreaterThan(0);
      expect(kpi.window).toEqual({
        from: result.window.from,
        to: result.window.to,
      });
    }
    expect(
      result.kpis.find((kpi) => kpi.key === 'first_response_rate')?.value,
    ).toBe(0.8);
    expect(
      result.kpis.find((kpi) => kpi.key === 'commercial_win_rate')?.value,
    ).toBe(0.25);
  });

  it('calls each underlying analytics source exactly once per request (no duplicate queries)', async () => {
    const h = harness();

    await h.service.getOverview(agencyCtx, {});

    expect(h.getOverview).toHaveBeenCalledTimes(1);
    expect(h.getCommercialJourney).toHaveBeenCalledTimes(1);
    expect(h.listStatus).toHaveBeenCalledTimes(1);
    expect(h.getCapacity).toHaveBeenCalledTimes(1);
  });

  it('defaults to a 7-day freshness window when no from/to is given', async () => {
    const h = harness();

    const result = await h.service.getOverview(agencyCtx, {});

    expect(result.window.days).toBe(7);
  });

  it('rejects an inverted period', async () => {
    const h = harness();

    await expect(
      h.service.getOverview(agencyCtx, {
        from: '2026-07-22T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a period longer than the 90-day cap', async () => {
    const h = harness();

    await expect(
      h.service.getOverview(agencyCtx, {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('marks every domain ok when there is healthy activity and a connected channel', async () => {
    const h = harness();

    const result = await h.service.getOverview(agencyCtx, {});

    expect(result.domainHealth.inbox.status).toBe('ok');
    expect(result.domainHealth.crm.status).toBe('ok');
    expect(result.domainHealth.automations.status).toBe('attention'); // fixture has 1 failed run
    expect(
      result.priorities.find((p) => p.key === 'automations_partial_failures'),
    ).toBeTruthy();
  });

  it('declares no_data instead of inventing a zero when a domain has no facts in window', async () => {
    const h = harness();
    h.getOverview.mockResolvedValue(
      operationalFixture({
        messages: { inboundConversations: 0, respondedConversations: 0 },
        automations: { runs: 0, succeeded: 0, failed: 0 },
      }),
    );
    h.getCommercialJourney.mockResolvedValue(
      commercialFixture({ summary: { opportunities: 0, won: 0 } }),
    );

    const result = await h.service.getOverview(agencyCtx, {});

    expect(result.domainHealth.inbox.status).toBe('no_data');
    expect(result.domainHealth.crm.status).toBe('no_data');
    expect(result.domainHealth.automations.status).toBe('no_data');
  });

  it('flags a critical inbox priority and health when no WhatsApp channel is connected', async () => {
    const h = harness();
    h.listStatus.mockResolvedValue({
      state: 'not_connected',
      primaryChannel: null,
      channels: [],
    });

    const result = await h.service.getOverview(agencyCtx, {});

    expect(result.domainHealth.inbox.status).toBe('no_data');
    expect(
      result.priorities.find((p) => p.key === 'whatsapp_not_configured')
        ?.severity,
    ).toBe('critical');
  });

  it('flags critical automations when every run in the window failed', async () => {
    const h = harness();
    h.getOverview.mockResolvedValue(
      operationalFixture({
        automations: { runs: 3, succeeded: 0, failed: 3, successRate: 0 },
      }),
    );

    const result = await h.service.getOverview(agencyCtx, {});

    expect(result.domainHealth.automations.status).toBe('critical');
    expect(
      result.priorities.find((p) => p.key === 'automations_failing')?.severity,
    ).toBe('critical');
  });

  it('surfaces an info priority listing hot lead transitions', async () => {
    const h = harness();
    h.getOverview.mockResolvedValue(operationalFixture({ hotTransitions: 3 }));

    const result = await h.service.getOverview(agencyCtx, {});

    const priority = result.priorities.find((p) => p.key === 'hot_leads');
    expect(priority?.severity).toBe('info');
    expect(priority?.title).toContain('3');
  });

  it('flags company capacity as full only in agency context with a configured limit', async () => {
    const h = harness();
    h.getCapacity.mockResolvedValue({
      activeCompanies: 5,
      limit: 5,
      availableSlots: 0,
      planKey: 'pro',
      entitlementStatus: 'active',
    });

    const result = await h.service.getOverview(agencyCtx, {});

    expect(
      result.priorities.find((p) => p.key === 'company_capacity_full'),
    ).toBeTruthy();
  });

  it('does not fetch company capacity or flag it in client (B2B) context', async () => {
    const h = harness();

    const result = await h.service.getOverview(clientCtx, {});

    expect(h.getCapacity).not.toHaveBeenCalled();
    expect(result.context).toEqual({
      operatingMode: 'client',
      clientId: 'client-1',
    });
    expect(
      result.priorities.find((p) => p.key === 'company_capacity_full'),
    ).toBeFalsy();
  });

  it('scopes WhatsApp channel status to the active client and ignores other clients/agency channels (cross-tenant isolation)', async () => {
    const h = harness();
    h.listStatus.mockResolvedValue({
      state: 'connected',
      primaryChannel: null,
      channels: [
        whatsappChannel({
          state: 'connected',
          metadata: { operatingMode: 'client', clientId: 'other-client' },
        }),
        whatsappChannel({ state: 'connected' }), // agency channel
      ],
    });

    const result = await h.service.getOverview(clientCtx, {});

    // Neither channel belongs to client-1, so the scoped state must fall back
    // to not_connected rather than leaking another client's/the agency's health.
    expect(result.domainHealth.inbox.status).toBe('no_data');
    expect(
      result.priorities.find((p) => p.key === 'whatsapp_not_configured'),
    ).toBeTruthy();
  });

  it('resolves the matching client channel and reports its own state', async () => {
    const h = harness();
    h.listStatus.mockResolvedValue({
      state: 'connected',
      primaryChannel: null,
      channels: [
        whatsappChannel({
          state: 'failed',
          metadata: { operatingMode: 'client', clientId: 'client-1' },
        }),
        whatsappChannel({
          state: 'connected',
          metadata: { operatingMode: 'client', clientId: 'other-client' },
        }),
      ],
    });

    const result = await h.service.getOverview(clientCtx, {});

    expect(result.domainHealth.inbox.status).toBe('critical');
  });
});
