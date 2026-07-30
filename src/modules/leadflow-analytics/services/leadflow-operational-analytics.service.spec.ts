import { BadRequestException } from '@nestjs/common';
import { LeadFlowOperationalAnalyticsService } from './leadflow-operational-analytics.service';

describe('LeadFlowOperationalAnalyticsService', () => {
  it('uses scoped, parameterized and content-free operational reads', async () => {
    const query = jest.fn((sql: string, params?: unknown[]) => {
      void params;
      if (sql.includes('channel-options')) {
        return Promise.resolve([
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            name: 'WhatsApp',
            type: 'whatsapp',
          },
        ]);
      }
      if (sql.includes('agent-options')) {
        return Promise.resolve([
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            name: 'SDR',
            type: 'qualifier',
          },
        ]);
      }
      if (sql.includes('business-mode-options')) {
        return Promise.resolve([{ businessMode: 'general' }]);
      }
      return Promise.resolve([]);
    });
    const service = new LeadFlowOperationalAnalyticsService({
      query,
    } as never);

    const result = await service.getOverview(
      {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        managedContext: {
          productKey: 'leadflow',
          operatingMode: 'client',
          clientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          managedTenantId: null,
        },
      },
      {
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-22T00:00:00.000Z',
        channelId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        businessMode: 'general',
        agentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
    );

    const calls = query.mock.calls.map(([sql, params]) => ({
      sql,
      params: params as unknown[],
    }));
    const messageCall = calls.find(({ sql }) => sql.includes('message-facts'));
    expect(messageCall?.sql).toContain("channel.metadata->>'clientId' = $4");
    expect(messageCall?.sql).not.toMatch(/message\.content|attachments/);
    expect(messageCall?.sql).not.toContain(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    );
    expect(messageCall?.params).toEqual(
      expect.arrayContaining([
        'tenant',
        'workspace',
        'client',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'general',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ]),
    );
    expect(result.appliedFilters).toEqual({
      channelId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      businessMode: 'general',
      agentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    expect(result.dataQuality.filtersNotApplicableToAutomationRuns).toEqual([
      'channelId',
      'agentId',
    ]);
  });

  it('rejects a dimension outside the active operating context', async () => {
    const service = new LeadFlowOperationalAnalyticsService({
      query: jest.fn().mockResolvedValue([]),
    } as never);

    await expect(
      service.getOverview(
        { tenantId: 'tenant', workspaceId: 'workspace' },
        {
          from: '2026-07-01T00:00:00.000Z',
          to: '2026-07-22T00:00:00.000Z',
          channelId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires tenant/workspace and rejects an inverted period before SQL', async () => {
    const query = jest.fn();
    const service = new LeadFlowOperationalAnalyticsService({
      query,
    } as never);

    await expect(service.getOverview({} as never, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.getOverview(
        { tenantId: 'tenant', workspaceId: 'workspace' },
        {
          from: '2026-07-22T00:00:00.000Z',
          to: '2026-07-01T00:00:00.000Z',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });
});
