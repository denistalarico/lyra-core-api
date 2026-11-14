import type { GoogleAdsRawPage } from '../services/google-ads-reader.service';
import {
  microsToMinor,
  normalizeGoogleAdsAds,
  normalizeGoogleAdsCampaigns,
} from './google-ads-entity.normalizer';
import { normalizeGoogleAdsMetrics } from './google-ads-insights.normalizer';

const page = (rows: Array<Record<string, unknown>>): GoogleAdsRawPage => ({
  rows,
  truncated: false,
  apiCalls: 1,
});

const entityContext = { customerId: '1234567890', currency: 'BRL' };

const metricContext = {
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: null,
  connectionId: 'c',
  provider: 'google_ads' as const,
  entityLevel: 'campaign' as const,
  customerId: '1234567890',
  accountTimezone: 'America/Sao_Paulo',
  currency: 'BRL',
  isPartial: false,
  syncedAt: new Date('2026-11-13T07:00:00Z'),
};

describe('Google Ads entity normalizer', () => {
  it('converts budget micros to minor units without floats', () => {
    expect(microsToMinor('50000000')).toBe('5000');
  });

  it('maps ENABLED to the ACTIVE vocabulary the campaign filter reads', () => {
    const [campaign] = normalizeGoogleAdsCampaigns(
      page([{ campaign: { id: '11', name: 'A', status: 'ENABLED' } }]),
      entityContext,
    ).rows;

    expect(campaign.effectiveStatus).toBe('ACTIVE');
  });

  it('maps REMOVED to ARCHIVED', () => {
    const [campaign] = normalizeGoogleAdsCampaigns(
      page([{ campaign: { id: '11', status: 'REMOVED' } }]),
      entityContext,
    ).rows;

    expect(campaign.status).toBe('ARCHIVED');
  });

  it('keeps the campaign type as the objective label', () => {
    const [campaign] = normalizeGoogleAdsCampaigns(
      page([
        {
          campaign: {
            id: '11',
            status: 'PAUSED',
            advertisingChannelType: 'PERFORMANCE_MAX',
          },
        },
      ]),
      entityContext,
    ).rows;

    expect(campaign.objective).toBe('PERFORMANCE_MAX');
  });

  it('puts a DAILY budget in the daily column', () => {
    const [campaign] = normalizeGoogleAdsCampaigns(
      page([
        {
          campaign: { id: '11' },
          campaignBudget: { amountMicros: '20000000', period: 'DAILY' },
        },
      ]),
      entityContext,
    ).rows;

    expect(campaign.dailyBudgetMinor).toBe('2000');
  });

  it('treats the 2037-12-30 sentinel as no end date', () => {
    const [campaign] = normalizeGoogleAdsCampaigns(
      page([{ campaign: { id: '11', endDate: '2037-12-30' } }]),
      entityContext,
    ).rows;

    expect(campaign.stopTime).toBeNull();
  });

  it('counts a campaign without an id as skipped', () => {
    expect(
      normalizeGoogleAdsCampaigns(page([{ campaign: {} }]), entityContext)
        .skipped,
    ).toBe(1);
  });

  it('never invents a Meta destination for an ad', () => {
    const [ad] = normalizeGoogleAdsAds(
      page([
        {
          adGroupAd: { ad: { id: '9' }, status: 'ENABLED' },
          adGroup: { id: '8' },
          campaign: { id: '7' },
        },
      ]),
      entityContext,
    ).rows;

    expect(ad.destinationType).toBeNull();
  });

  it('links an ad to its ad group and campaign', () => {
    const [ad] = normalizeGoogleAdsAds(
      page([
        {
          adGroupAd: { ad: { id: '9' } },
          adGroup: { id: '8' },
          campaign: { id: '7' },
        },
      ]),
      entityContext,
    ).rows;

    expect([ad.parentExternalId, ad.campaignExternalId]).toEqual(['8', '7']);
  });
});

describe('Google Ads insights normalizer', () => {
  const row = {
    campaign: { id: '11' },
    segments: { date: '2026-11-10' },
    metrics: {
      costMicros: '12345678',
      impressions: '1000',
      clicks: '40',
      conversions: 2.5,
      conversionsValue: 300,
    },
  };

  it('formats cost micros as the unit amount', () => {
    const [fact] = normalizeGoogleAdsMetrics(page([row]), metricContext).rows;

    expect(fact.spend).toBe('12.345678');
  });

  it('keeps fractional conversions', () => {
    const [fact] = normalizeGoogleAdsMetrics(page([row]), metricContext).rows;

    expect(fact.conversions).toBe('2.500000');
  });

  it('leaves Meta-only columns null instead of zero', () => {
    const [fact] = normalizeGoogleAdsMetrics(page([row]), metricContext).rows;

    expect([fact.reach, fact.thruplays, fact.messagingConversations]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('stores the provider and the day verbatim', () => {
    const [fact] = normalizeGoogleAdsMetrics(page([row]), metricContext).rows;

    expect([fact.provider, fact.metricDate]).toEqual([
      'google_ads',
      '2026-11-10',
    ]);
  });

  it('carries the run mode into is_partial', () => {
    const [fact] = normalizeGoogleAdsMetrics(page([row]), {
      ...metricContext,
      isPartial: true,
    }).rows;

    expect(fact.isPartial).toBe(true);
  });

  it('skips a row without a readable day', () => {
    expect(
      normalizeGoogleAdsMetrics(
        page([{ ...row, segments: { date: 'x' } }]),
        metricContext,
      ).skipped,
    ).toBe(1);
  });

  it('uses the customer id as the account-level entity', () => {
    const [fact] = normalizeGoogleAdsMetrics(
      page([{ segments: row.segments, metrics: row.metrics }]),
      { ...metricContext, entityLevel: 'account' },
    ).rows;

    expect(fact.entityExternalId).toBe('1234567890');
  });

  it('keys an ad-group row by its ad group and parent campaign', () => {
    const [fact] = normalizeGoogleAdsMetrics(
      page([{ ...row, adGroup: { id: '22' } }]),
      { ...metricContext, entityLevel: 'adset' },
    ).rows;

    expect([fact.entityExternalId, fact.campaignExternalId]).toEqual([
      '22',
      '11',
    ]);
  });
});
