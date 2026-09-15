import type { Repository } from 'typeorm';
import {
  SocialAdAccountConnectionEntity,
  SocialAdEntity,
  SocialAdMetricDailyEntity,
} from '../../social-integrations/entities';
import { MetaCampaignHierarchyReadService } from './meta-campaign-hierarchy-read.service';

function queryBuilder(result: {
  count?: number;
  many?: unknown[];
  rawMany?: unknown[];
  rawOne?: unknown;
}) {
  const builder: Record<string, jest.Mock> = {};
  for (const method of [
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
    'select',
    'addSelect',
    'groupBy',
    'addGroupBy',
  ]) {
    builder[method] = jest.fn(() => builder);
  }
  builder.getCount = jest.fn().mockResolvedValue(result.count ?? 0);
  builder.getMany = jest.fn().mockResolvedValue(result.many ?? []);
  builder.getRawMany = jest.fn().mockResolvedValue(result.rawMany ?? []);
  builder.getRawOne = jest.fn().mockResolvedValue(result.rawOne ?? null);
  return builder;
}

function mirroredEntity(
  level: SocialAdEntity['entityLevel'],
  id: string,
  overrides: Partial<SocialAdEntity> = {},
) {
  return {
    entityLevel: level,
    externalId: id,
    parentExternalId: null,
    campaignExternalId: level === 'campaign' ? id : 'campaign-1',
    name: `${level} ${id}`,
    status: 'ACTIVE',
    effectiveStatus: 'ACTIVE',
    archivedAt: null,
    objective: level === 'campaign' ? 'OUTCOME_TRAFFIC' : null,
    optimizationGoal: null,
    billingEvent: null,
    destinationType: level === 'adset' ? 'website' : null,
    destinationRaw: null,
    dailyBudgetMinor: null,
    lifetimeBudgetMinor: null,
    budgetRemainingMinor: null,
    currency: 'BRL',
    startTime: null,
    stopTime: null,
    providerUpdatedTime: null,
    lastSeenAt: new Date('2026-09-15T10:00:00Z'),
    ...overrides,
  } as SocialAdEntity;
}

describe('MetaCampaignHierarchyReadService', () => {
  it('assembles campaign, ad set and ad while keeping absent ad metrics null', async () => {
    const campaign = mirroredEntity('campaign', 'campaign-1');
    const adSet = mirroredEntity('adset', 'adset-1', {
      parentExternalId: 'campaign-1',
    });
    const ad = mirroredEntity('ad', 'ad-1', {
      parentExternalId: 'adset-1',
    });
    const campaignQuery = queryBuilder({ count: 1, many: [campaign] });
    const childrenQuery = queryBuilder({ many: [adSet, ad] });
    const freshnessQuery = queryBuilder({
      rawOne: { last_seen_at: '2026-09-15T10:00:00Z' },
    });
    const metricsQuery = queryBuilder({
      rawMany: [
        {
          entity_level: 'campaign',
          entity_external_id: 'campaign-1',
          spend: '25.000000',
          impressions: '1000',
          clicks: '20',
          leads: '2',
          conversions: '2.000000',
          partial_days: '0',
        },
        {
          entity_level: 'adset',
          entity_external_id: 'adset-1',
          spend: '25.000000',
          impressions: '1000',
          clicks: '20',
          leads: '2',
          conversions: '2.000000',
          partial_days: '0',
        },
      ],
    });

    const connections = {
      findOne: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000010',
        accountName: 'Conta Meta',
        currency: 'BRL',
        timezone: 'America/Sao_Paulo',
        connectionStatus: 'connected',
        lastSyncedAt: new Date('2026-09-15T11:00:00Z'),
        lastSyncError: null,
      }),
    };
    const entities = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(campaignQuery)
        .mockReturnValueOnce(childrenQuery)
        .mockReturnValueOnce(freshnessQuery),
    };
    const metrics = { createQueryBuilder: jest.fn(() => metricsQuery) };
    const service = new MetaCampaignHierarchyReadService(
      connections as unknown as Repository<SocialAdAccountConnectionEntity>,
      entities as unknown as Repository<SocialAdEntity>,
      metrics as unknown as Repository<SocialAdMetricDailyEntity>,
    );

    const result = await service.read({
      tenantId: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      agencyClientId: null,
      connectionId: '00000000-0000-4000-8000-000000000010',
      since: '2026-09-01',
      until: '2026-09-15',
    });

    expect(result.pagination).toEqual({
      page: 1,
      limit: 25,
      total: 1,
      totalPages: 1,
    });
    expect(result.items[0].adSets[0].ads[0].externalId).toBe('ad-1');
    expect(result.items[0].metrics.spend).toBe('25.000000');
    expect(result.items[0].adSets[0].metrics.hasData).toBe(true);
    expect(result.items[0].adSets[0].ads[0].metrics).toEqual({
      hasData: false,
      spend: null,
      impressions: null,
      clicks: null,
      leads: null,
      conversions: null,
      hasPartialData: false,
    });
  });
});
