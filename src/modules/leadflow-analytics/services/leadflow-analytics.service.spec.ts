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

  it('scopes the cohort to the selected client before reading any facts', async () => {
    const h = harness();

    const result = await h.service.getCommercialJourney(
      {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        managedContext: {
          productKey: 'leadflow',
          operatingMode: 'client',
          clientId: 'client-1',
          managedTenantId: null,
        },
      },
      period,
    );

    const call = h.findOpportunities.mock.calls[0][0] as {
      where: { metadata: { _type: string; _objectLiteralParameters: unknown } };
      withDeleted: boolean;
    };
    expect(call.withDeleted).toBe(true);
    expect(call.where.metadata).toMatchObject({
      _type: 'raw',
      _objectLiteralParameters: { analyticsClientId: 'client-1' },
    });
    expect(result.summary.opportunities).toBe(0);
    expect(h.opportunityEvents.find).not.toHaveBeenCalled();
    expect(h.conversationEvents.find).not.toHaveBeenCalled();
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
