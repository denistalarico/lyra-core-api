import {
  budgetToMinor,
  mapTikTokStatus,
  normalizeTikTokAdGroups,
  normalizeTikTokAds,
  normalizeTikTokCampaigns,
} from './tiktok-ads-entity.normalizer';
import { normalizeTikTokMetrics } from './tiktok-ads-insights.normalizer';

const page = (rows: Record<string, unknown>[], truncated = false) => ({
  rows,
  truncated,
  apiCalls: 1,
});
const CONTEXT = { advertiserId: '700', currency: 'BRL' };

describe('TikTok Ads entity normalizers (D-I8)', () => {
  it('turns a major-unit budget into minor units (× 100) without floats', () => {
    expect(budgetToMinor(50)).toBe('5000');
    expect(budgetToMinor(12.34)).toBe('1234');
    expect(budgetToMinor('99.9')).toBe('9990');
    expect(budgetToMinor(-1)).toBeNull();
  });

  it('maps the statuses, deletion first', () => {
    expect(mapTikTokStatus({ operation_status: 'ENABLE' })).toBe('ACTIVE');
    expect(mapTikTokStatus({ operation_status: 'DISABLE' })).toBe('PAUSED');
    expect(
      mapTikTokStatus({
        operation_status: 'ENABLE',
        secondary_status: 'CAMPAIGN_STATUS_DELETE',
      }),
    ).toBe('ARCHIVED');
  });

  it('maps campaign, ad group and ad onto the three levels', () => {
    const campaigns = normalizeTikTokCampaigns(
      page([
        {
          campaign_id: '1800',
          campaign_name: 'Black Friday',
          operation_status: 'ENABLE',
          budget_mode: 'BUDGET_MODE_DAY',
          budget: 50,
          objective_type: 'TRAFFIC',
          create_time: '2026-11-01 12:00:00',
        },
        { campaign_name: 'no id' },
      ]),
      CONTEXT,
    );
    expect(campaigns.skipped).toBe(1);
    expect(campaigns.rows[0]).toMatchObject({
      entityLevel: 'campaign',
      externalId: '1800',
      parentExternalId: '700',
      dailyBudgetMinor: '5000',
      lifetimeBudgetMinor: null,
      objective: 'TRAFFIC',
    });
    expect(campaigns.rows[0].providerCreatedTime).toEqual(
      new Date('2026-11-01T12:00:00.000Z'),
    );

    const groups = normalizeTikTokAdGroups(
      page([
        {
          adgroup_id: '1801',
          campaign_id: '1800',
          budget_mode: 'BUDGET_MODE_TOTAL',
          budget: '300',
          operation_status: 'DISABLE',
        },
      ]),
      CONTEXT,
    );
    expect(groups.rows[0]).toMatchObject({
      entityLevel: 'adset',
      parentExternalId: '1800',
      campaignExternalId: '1800',
      lifetimeBudgetMinor: '30000',
      status: 'PAUSED',
    });

    const ads = normalizeTikTokAds(
      page([
        { ad_id: '1802', adgroup_id: '1801', campaign_id: '1800' },
        { ad_id: '1803', campaign_id: '1800' },
      ]),
      CONTEXT,
    );
    expect(ads.skipped).toBe(1);
    expect(ads.rows[0]).toMatchObject({
      entityLevel: 'ad',
      parentExternalId: '1801',
      campaignExternalId: '1800',
      name: 'Anúncio 1802',
    });
  });
});

describe('TikTok Ads insights normalizer', () => {
  const context = {
    tenantId: 't',
    workspaceId: 'w',
    agencyClientId: null,
    connectionId: 'c',
    provider: 'tiktok_ads' as const,
    advertiserId: '700',
    accountTimezone: 'America/Sao_Paulo',
    currency: 'BRL',
    campaignByEntity: new Map([['1801', '1800']]),
    isPartial: false,
    syncedAt: new Date('2026-11-16T00:00:00Z'),
  };
  const row = {
    dimensions: { adgroup_id: '1801', stat_time_day: '2026-11-14 00:00:00' },
    metrics: {
      spend: '12.34',
      impressions: '1000',
      clicks: '20',
      reach: '800',
      frequency: '1.25',
      conversion: '3',
      video_play_actions: '500',
    },
  };

  it('turns a daily ad group row into a mirror fact with reach', () => {
    const out = normalizeTikTokMetrics(page([row]), {
      ...context,
      entityLevel: 'adset',
    });

    expect(out.rows[0]).toMatchObject({
      entityExternalId: '1801',
      campaignExternalId: '1800',
      metricDate: '2026-11-14',
      spend: '12.340000',
      impressions: '1000',
      reach: '800',
      clicks: '20',
      conversions: '3.000000',
      videoViews: '500',
      provider: 'tiktok_ads',
      actions: {
        mappingVersion: 'tiktok_ads_v1',
        extras: { frequency: '1.250000' },
      },
    });
  });

  it('skips an unknown entity, a bad date and a malformed metric', () => {
    const unknown = {
      ...row,
      dimensions: { ...row.dimensions, adgroup_id: '9' },
    };
    const badDay = {
      ...row,
      dimensions: { ...row.dimensions, stat_time_day: 'x' },
    };
    const bad = { ...row, metrics: { ...row.metrics, spend: 'abc' } };
    const out = normalizeTikTokMetrics(page([unknown, badDay, bad, row]), {
      ...context,
      entityLevel: 'adset',
    });

    expect(out.rows).toHaveLength(1);
    expect(out.skipped).toBe(3);
  });
});
