import { BadRequestException } from '@nestjs/common';
import { LeadFlowAnalyticsService } from './leadflow-analytics.service';

function harness() {
  const findOpportunities = jest.fn((options: unknown) => {
    void options;
    return Promise.resolve([]);
  });
  const opportunities = { find: findOpportunities };
  const opportunityEvents = { find: jest.fn().mockResolvedValue([]) };
  const pipelines = { find: jest.fn().mockResolvedValue([]) };
  const stages = { find: jest.fn().mockResolvedValue([]) };
  const conversationEvents = { find: jest.fn().mockResolvedValue([]) };
  const service = new LeadFlowAnalyticsService(
    opportunities as never,
    opportunityEvents as never,
    pipelines as never,
    stages as never,
    conversationEvents as never,
  );
  return {
    service,
    opportunities,
    findOpportunities,
    opportunityEvents,
    pipelines,
    stages,
    conversationEvents,
  };
}

describe('LeadFlowAnalyticsService', () => {
  const period = {
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-07-22T00:00:00.000Z',
  };

  const clientCtx = {
    tenantId: 'tenant',
    workspaceId: 'workspace',
    managedContext: {
      productKey: 'leadflow' as const,
      operatingMode: 'client' as const,
      clientId: 'client-1',
      // CC2G.1: client mode still requires a company; without one the read
      // model fails closed instead of aggregating every company.
      companyContextId: 'company-1',
      managedTenantId: null,
    },
  };

  it('scopes the cohort to the selected client and company before reading any facts', async () => {
    const h = harness();

    const result = await h.service.getCommercialJourney(clientCtx, period);

    const call = h.findOpportunities.mock.calls[0][0] as {
      where: { agencyClientId: unknown; companyContextId: unknown };
      withDeleted: boolean;
    };
    expect(call.withDeleted).toBe(true);
    // CC2G.1: the persisted columns, not the legacy `metadata->>'clientId'`
    // JSONB stamp — and both the client and the company must be present, so a
    // predicate that only tested `agencyClientId` could not slip through.
    expect(call.where.agencyClientId).toBe('client-1');
    expect(call.where.companyContextId).toBe('company-1');
    expect(result.summary.opportunities).toBe(0);
    expect(h.opportunityEvents.find).not.toHaveBeenCalled();
    expect(h.conversationEvents.find).not.toHaveBeenCalled();
  });

  /** Minimal enough to satisfy the projector; scope is what these tests check. */
  function fixtureOpportunity(): unknown {
    return {
      id: 'opp-1',
      pipelineId: 'pipeline-a',
      stageId: 'stage-1',
      inboxConversationId: null,
      createdAt: new Date('2026-07-05T00:00:00.000Z'),
      status: 'open',
      businessMode: 'general',
    };
  }

  it('scopes pipelines by the same persisted columns as opportunities', async () => {
    const h = harness();
    h.findOpportunities.mockResolvedValueOnce([fixtureOpportunity()] as never);

    await h.service.getCommercialJourney(clientCtx, period);

    const pipelineCall = h.pipelines.find.mock.calls[0][0] as {
      where: { agencyClientId: unknown; companyContextId: unknown };
    };
    expect(pipelineCall.where.agencyClientId).toBe('client-1');
    expect(pipelineCall.where.companyContextId).toBe('company-1');
  });

  it('reads stages only through the already-scoped pipeline set, not by a scope of their own', async () => {
    const h = harness();
    h.findOpportunities.mockResolvedValueOnce([fixtureOpportunity()] as never);
    h.pipelines.find.mockResolvedValueOnce([
      { id: 'pipeline-a', name: 'Pipeline A' },
      { id: 'pipeline-b', name: 'Pipeline B' },
    ]);

    await h.service.getCommercialJourney(clientCtx, period);

    const stageCall = h.stages.find.mock.calls[0][0] as {
      where: { pipelineId: { _value: string[] } };
    };
    // `In([...])` rather than a company column — crm_stages has none, so
    // scope must come from the pipeline ids already proven to belong to this
    // company, and only those.
    expect(stageCall.where.pipelineId._value).toEqual([
      'pipeline-a',
      'pipeline-b',
    ]);
  });

  it('reads no stages at all when the scope resolves zero pipelines', async () => {
    const h = harness();
    h.findOpportunities.mockResolvedValueOnce([fixtureOpportunity()] as never);
    h.pipelines.find.mockResolvedValueOnce([]);

    await h.service.getCommercialJourney(clientCtx, period);

    expect(h.stages.find).not.toHaveBeenCalled();
  });

  it('scopes agency mode by NULL columns, never by an absent predicate', async () => {
    const h = harness();

    await h.service.getCommercialJourney(
      { tenantId: 'tenant', workspaceId: 'workspace' },
      period,
    );

    const call = h.findOpportunities.mock.calls[0][0] as {
      where: { agencyClientId: unknown; companyContextId: unknown };
    };
    expect(call.where.agencyClientId).toMatchObject({ _type: 'isNull' });
    expect(call.where.companyContextId).toMatchObject({ _type: 'isNull' });
  });

  it('refuses client mode without a company instead of aggregating every company', async () => {
    const h = harness();

    await expect(
      h.service.getCommercialJourney(
        {
          tenantId: 'tenant',
          workspaceId: 'workspace',
          managedContext: {
            productKey: 'leadflow',
            operatingMode: 'client',
            clientId: 'client-1',
            companyContextId: null,
            managedTenantId: null,
          },
        } as never,
        period,
      ),
    ).rejects.toMatchObject({ response: { code: 'company_context_required' } });
    expect(h.opportunities.find).not.toHaveBeenCalled();
  });

  it('rejects an inverted or excessively large cohort period', async () => {
    const h = harness();

    await expect(
      h.service.getCommercialJourney(
        { tenantId: 'tenant', workspaceId: 'workspace' },
        {
          from: '2026-07-22T00:00:00.000Z',
          to: '2026-07-01T00:00:00.000Z',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.service.getCommercialJourney(
        { tenantId: 'tenant', workspaceId: 'workspace' },
        {
          from: '2025-01-01T00:00:00.000Z',
          to: '2026-07-01T00:00:00.000Z',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.opportunities.find).not.toHaveBeenCalled();
  });
});
