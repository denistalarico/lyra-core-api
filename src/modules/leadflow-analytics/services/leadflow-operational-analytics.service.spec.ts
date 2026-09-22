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
          // CC2G: client mode now requires a company.
          companyContextId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
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
    // CC2G.1: the company-aware predicate reads the persisted columns, not the
    // legacy `metadata->>'clientId'` JSONB stamp — and it binds the Company
    // Context id as a fifth scope parameter ($5) alongside the client id ($4).
    expect(messageCall?.sql).toContain(
      'channel.agency_client_id = $4::uuid AND channel.company_context_id = $5::uuid',
    );
    expect(messageCall?.sql).not.toContain("metadata->>'clientId'");
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
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
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
  /**
   * CC2G.1: `resolveCompanyAwareScope` still refuses a legacy client-mode
   * selection (a client with no Company Context) before any query is built —
   * CC2G.1 replaced the *aggregate* fallback this read model used once a
   * company was actually selected, not this refusal.
   */
  it('refuses client mode without a company instead of returning client-wide data', async () => {
    const query = jest.fn(() => Promise.resolve([]));
    const service = new LeadFlowOperationalAnalyticsService({
      query,
    } as never);

    await expect(
      service.getOverview(
        {
          tenantId: 'tenant',
          workspaceId: 'workspace',
          managedContext: {
            productKey: 'leadflow',
            operatingMode: 'client',
            clientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            companyContextId: null,
            managedTenantId: null,
          },
        } as never,
        {
          from: '2026-07-01T00:00:00.000Z',
          to: '2026-07-22T00:00:00.000Z',
        } as never,
      ),
    ).rejects.toMatchObject({
      response: { code: 'company_context_required' },
    });
    expect(query).not.toHaveBeenCalled();
  });

  /**
   * CC2G.1's SQL safety regression: proves `company_context_id` is genuinely
   * part of every scoped predicate in client mode, not merely a bound and
   * ignored parameter. A query whose WHERE clause tested only
   * `agency_client_id = $4` would pass every other test in this file (the
   * fixture only ever uses one company per client) while silently aggregating
   * every company of the client — exactly the regression CC2G.1 exists to
   * close.
   */
  it('binds company_context_id as an actual predicate on every scoped query, not just agency_client_id', async () => {
    const query = jest.fn((sql: string, params?: unknown[]) => {
      void params;
      return Promise.resolve([]);
    });
    const service = new LeadFlowOperationalAnalyticsService({
      query,
    } as never);

    await service.getOverview(
      {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        managedContext: {
          productKey: 'leadflow',
          operatingMode: 'client',
          clientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          companyContextId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          managedTenantId: null,
        },
      } as never,
      {
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-22T00:00:00.000Z',
      } as never,
    );

    const scopedLabels = [
      'channel-options',
      'agent-options',
      'business-mode-options',
      'message-facts',
      'score-facts',
      'run-facts',
    ];
    const calls = query.mock.calls.map(([sql]) => sql as string);
    for (const label of scopedLabels) {
      const sql = calls.find((call) => call.includes(label));
      expect(sql).toBeDefined();
      // Every predicate must test company_context_id, and it must be tied to
      // the client branch by AND — not merely present anywhere in the string,
      // which an unrelated bound parameter comment could satisfy too.
      expect(sql).toMatch(/company_context_id\s*=\s*\$5::uuid/);
      expect(sql).not.toContain("metadata->>'clientId'");
    }
  });
});
