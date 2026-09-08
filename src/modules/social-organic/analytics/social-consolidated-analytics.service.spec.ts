/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- read-service doubles are inspected via `.mock.calls`, crossing Jest's untyped mock boundary. */
import { NotFoundException } from '@nestjs/common';
import type { SocialAnalyticsReadService } from '../../social-integrations/services/social-analytics-read.service';
import { SocialConsolidatedAnalyticsService } from './social-consolidated-analytics.service';
import type { SocialOrganicAnalyticsReadService } from './social-organic-analytics-read.service';

function paidOverview(overrides: Record<string, unknown> = {}) {
  return {
    connectionId: 'paid-connection-1',
    timezone: 'America/Sao_Paulo',
    currency: 'BRL',
    period: { since: '2026-08-01', until: '2026-08-27' },
    comparisonPeriod: { since: '2026-07-05', until: '2026-07-31' },
    current: {
      spend: '100.000000',
      impressions: '1000',
      clicks: '20',
      linkClicks: '15',
      leads: '2',
      conversions: '1.000000',
      conversionValue: '50.000000',
      videoViews: '100',
      reach: null,
      reachGranularity: 'daily',
      ctr: '2.000000',
      cpc: '5.000000',
      cpm: '100.000000',
      cpl: '50.000000',
      cpa: '100.000000',
      roas: '0.500000',
    },
    previous: {},
    change: {},
    hasPartialData: false,
    lastFactDate: '2026-08-27',
    ...overrides,
  };
}

function organicOverview(overrides: Record<string, unknown> = {}) {
  return {
    assetId: 'organic-asset-1',
    timezone: 'America/Sao_Paulo',
    period: { since: '2026-08-01', until: '2026-08-27' },
    totals: {
      impressions: '500',
      reach: null,
      reachGranularity: 'daily',
      followersCount: '1200',
      followersGained: '10',
      followersLost: '2',
      profileViews: '30',
    },
    hasPartialData: false,
    lastFactDate: '2026-08-26',
    ...overrides,
  };
}

function harness() {
  const paidReads = {
    overview: jest.fn().mockResolvedValue(paidOverview()),
  };
  const organicReads = {
    overview: jest.fn().mockResolvedValue(organicOverview()),
  };

  return {
    paidReads,
    organicReads,
    service: new SocialConsolidatedAnalyticsService(
      paidReads as unknown as SocialAnalyticsReadService,
      organicReads as unknown as SocialOrganicAnalyticsReadService,
    ),
  };
}

const input = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  agencyClientId: null,
  paidConnectionId: 'paid-connection-1',
  organicAssetId: 'organic-asset-1',
  since: '2026-08-01',
  until: '2026-08-27',
};

describe('SocialConsolidatedAnalyticsService', () => {
  it('never returns a combined/total/sum/all key anywhere in the response', async () => {
    const { service } = harness();

    const result = await service.overview(input);

    const suspicious = /total|combined|sum|all/i;
    function walk(value: unknown, path: string): string[] {
      if (Array.isArray(value)) {
        return value.flatMap((entry, i) => walk(entry, `${path}[${i}]`));
      }
      if (value && typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>).flatMap(
          ([key, entry]) => {
            const hits = suspicious.test(key) ? [`${path}.${key}`] : [];
            return [...hits, ...walk(entry, `${path}.${key}`)];
          },
        );
      }
      return [];
    }

    // `paid.totals`/`organic.totals` are the one expected pass-through
    // exception to the naming rule (they are the underlying read services'
    // own field names, not something this service invented) — walk the rest
    // of the tree excluding those two subtrees.
    const paidWithoutTotals: Record<string, unknown> = { ...result.paid };
    delete paidWithoutTotals.totals;
    const organicWithoutTotals: Record<string, unknown> = {
      ...result.organic,
    };
    delete organicWithoutTotals.totals;

    const outsideTotals = walk(
      {
        period: result.period,
        paid: paidWithoutTotals,
        organic: organicWithoutTotals,
      },
      '',
    );

    expect(outsideTotals).toEqual([]);
  });

  it('calls the paid read service exactly once with the mapped input', async () => {
    const { service, paidReads } = harness();

    await service.overview(input);

    expect(paidReads.overview).toHaveBeenCalledTimes(1);
    expect(paidReads.overview).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: null,
      connectionId: 'paid-connection-1',
      since: '2026-08-01',
      until: '2026-08-27',
    });
  });

  it('calls the organic read service exactly once with the mapped input', async () => {
    const { service, organicReads } = harness();

    await service.overview(input);

    expect(organicReads.overview).toHaveBeenCalledTimes(1);
    expect(organicReads.overview).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: null,
      assetId: 'organic-asset-1',
      since: '2026-08-01',
      until: '2026-08-27',
    });
  });

  it('propagates the exact same scope object to both calls, not two independently built ones', async () => {
    const { service, paidReads, organicReads } = harness();

    await service.overview({ ...input, agencyClientId: 'client-9' });

    const paidCall = paidReads.overview.mock.calls[0][0];
    const organicCall = organicReads.overview.mock.calls[0][0];

    expect(paidCall.tenantId).toBe(organicCall.tenantId);
    expect(paidCall.workspaceId).toBe(organicCall.workspaceId);
    expect(paidCall.agencyClientId).toBe(organicCall.agencyClientId);
    expect(paidCall.agencyClientId).toBe('client-9');
  });

  it('propagates a cross-tenant NotFoundException from the paid side without swallowing it into a partial success', async () => {
    const { service, paidReads } = harness();
    paidReads.overview.mockRejectedValue(
      new NotFoundException('Connection not found.'),
    );

    await expect(service.overview(input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('propagates a cross-tenant NotFoundException from the organic side without swallowing it into a partial success', async () => {
    const { service, organicReads } = harness();
    organicReads.overview.mockRejectedValue(
      new NotFoundException('Asset not found.'),
    );

    await expect(service.overview(input)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('surfaces timezone/currency independently per side, never assumed equal', async () => {
    const { service, paidReads, organicReads } = harness();
    paidReads.overview.mockResolvedValue(
      paidOverview({ timezone: 'America/New_York', currency: 'USD' }),
    );
    organicReads.overview.mockResolvedValue(
      organicOverview({ timezone: 'Asia/Tokyo' }),
    );

    const result = await service.overview(input);

    expect(result.paid.timezone).toBe('America/New_York');
    expect(result.paid.currency).toBe('USD');
    expect(result.organic.timezone).toBe('Asia/Tokyo');
  });

  it("passes each side's totals through unchanged (pure merge, no arithmetic)", async () => {
    const { service } = harness();

    const result = await service.overview(input);

    expect(result.paid.totals).toEqual(paidOverview().current);
    expect(result.organic.totals).toEqual(organicOverview().totals);
  });
});
