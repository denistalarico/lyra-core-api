import {
  campaignGroupIndex,
  linkedInId,
  normalizeLinkedInAccount,
  normalizeLinkedInCampaignGroups,
  normalizeLinkedInCampaigns,
  normalizeLinkedInCreatives,
} from './linkedin-ads-entity.normalizer';
import { normalizeLinkedInMetrics } from './linkedin-ads-insights.normalizer';

/**
 * Fixtures follow the sample responses of the official docs (version 202610):
 * https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-accounts
 * .../create-and-manage-campaign-groups, .../create-and-manage-campaigns,
 * .../create-and-manage-creatives and .../ads-reporting/ads-reporting
 */
const page = (rows: Record<string, unknown>[], truncated = false) => ({
  rows,
  truncated,
  apiCalls: 1,
});
const CONTEXT = { accountId: '506333826', currency: 'BRL' };

describe('LinkedIn Ads entity normalizers (D-I8)', () => {
  it('reads ids from numbers and URNs and nothing else', () => {
    expect(linkedInId(145282384)).toBe('145282384');
    expect(linkedInId('urn:li:sponsoredCampaign:145282384')).toBe('145282384');
    expect(linkedInId('urn:li:sponsoredCreative:119962155')).toBe('119962155');
    expect(linkedInId('abc')).toBeNull();
    expect(linkedInId(undefined)).toBeNull();
  });

  it('maps the ad account to the account node', () => {
    const out = normalizeLinkedInAccount(
      page([
        {
          id: 506333826,
          name: 'Dunder Mifflin Account',
          currency: 'USD',
          status: 'ACTIVE',
          type: 'BUSINESS',
        },
      ]),
      CONTEXT,
    );

    expect(out.rows[0]).toMatchObject({
      entityLevel: 'account',
      externalId: '506333826',
      parentExternalId: null,
      name: 'Dunder Mifflin Account',
      currency: 'USD',
      status: 'ACTIVE',
    });
  });

  it('maps campaign group → campaign with lifetime budget in minor units', () => {
    const out = normalizeLinkedInCampaignGroups(
      page([
        {
          id: 603407684,
          name: 'Refresh group',
          status: 'CANCELED',
          runSchedule: { start: 1234567890987, end: 9876543210123 },
          totalBudget: { amount: '60000.00', currencyCode: 'USD' },
        },
        { name: 'no id' },
      ]),
      CONTEXT,
    );

    expect(out.skipped).toBe(1);
    expect(out.rows[0]).toMatchObject({
      entityLevel: 'campaign',
      externalId: '603407684',
      parentExternalId: '506333826',
      campaignExternalId: '603407684',
      status: 'ARCHIVED',
      lifetimeBudgetMinor: '6000000',
      dailyBudgetMinor: null,
    });
    expect(out.rows[0].startTime).toEqual(new Date(1234567890987));
    expect(out.rows[0].metadata).toMatchObject({ linkedinStatus: 'CANCELED' });
  });

  it('maps campaign → adset under its group, daily budget in minor units', () => {
    const out = normalizeLinkedInCampaigns(
      page([
        {
          id: 145282384,
          name: 'Campaign Sponsored update B',
          status: 'ACTIVE',
          campaignGroup: 'urn:li:sponsoredCampaignGroup:603030884',
          dailyBudget: { amount: '18', currencyCode: 'USD' },
          costType: 'CPC',
          type: 'SPONSORED_UPDATES',
        },
        { id: 1, status: 'ACTIVE' },
      ]),
      CONTEXT,
    );

    expect(out.skipped).toBe(1);
    expect(out.rows[0]).toMatchObject({
      entityLevel: 'adset',
      externalId: '145282384',
      parentExternalId: '603030884',
      campaignExternalId: '603030884',
      dailyBudgetMinor: '1800',
      billingEvent: 'CPC',
    });
  });

  it('maps creative → ad, taking the group through its campaign', () => {
    const campaigns = page([
      {
        id: 360035215,
        campaignGroup: 'urn:li:sponsoredCampaignGroup:603030884',
      },
    ]);
    const out = normalizeLinkedInCreatives(
      page([
        {
          id: 'urn:li:sponsoredCreative:119962155',
          campaign: 'urn:li:sponsoredCampaign:360035215',
          intendedStatus: 'DRAFT',
          isServing: false,
        },
        {
          id: 'urn:li:sponsoredCreative:2',
          campaign: 'urn:li:sponsoredCampaign:999',
          intendedStatus: 'ACTIVE',
        },
      ]),
      { ...CONTEXT, groupByCampaign: campaignGroupIndex(campaigns) },
    );

    // The second creative's campaign is unknown: skipped, never guessed.
    expect(out.skipped).toBe(1);
    expect(out.rows[0]).toMatchObject({
      entityLevel: 'ad',
      externalId: '119962155',
      parentExternalId: '360035215',
      campaignExternalId: '603030884',
      creativeId: '119962155',
      name: 'Criativo 119962155',
      status: 'DRAFT',
    });
  });
});

describe('LinkedIn Ads insights normalizer', () => {
  const context = {
    tenantId: 't',
    workspaceId: 'w',
    agencyClientId: null,
    connectionId: 'c',
    provider: 'linkedin_ads' as const,
    accountId: '506333826',
    accountTimezone: 'UTC',
    currency: 'BRL',
    groupByEntity: new Map([['145282384', '603030884']]),
    isPartial: false,
    syncedAt: new Date('2026-11-16T00:00:00Z'),
  };
  const day = { year: 2024, month: 5, day: 29 };
  const element = {
    pivotValues: ['urn:li:sponsoredCampaign:145282384'],
    dateRange: { start: day, end: day },
    impressions: 165,
    clicks: 12,
    landingPageClicks: 11,
    costInLocalCurrency: '19.91833',
    externalWebsiteConversions: 2,
    oneClickLeads: 1,
    videoViews: 0,
  };

  it('turns a daily campaign row into a mirror fact', () => {
    const out = normalizeLinkedInMetrics(page([element]), {
      ...context,
      entityLevel: 'adset',
    });

    expect(out.skipped).toBe(0);
    expect(out.rows[0]).toMatchObject({
      entityLevel: 'adset',
      entityExternalId: '145282384',
      campaignExternalId: '603030884',
      metricDate: '2024-05-29',
      spend: '19.918330',
      impressions: '165',
      clicks: '12',
      linkClicks: '11',
      leads: '1',
      conversions: '2.000000',
      conversionValue: '0.000000',
      reach: null,
      thruplays: null,
      isPartial: false,
      provider: 'linkedin_ads',
    });
  });

  it('refuses a row of another level, a multi-day row and an unknown entity', () => {
    const wrongLevel = {
      ...element,
      pivotValues: ['urn:li:sponsoredCreative:1'],
    };
    const multiDay = {
      ...element,
      dateRange: { start: day, end: { ...day, day: 30 } },
    };
    const unknown = {
      ...element,
      pivotValues: ['urn:li:sponsoredCampaign:777'],
    };
    const out = normalizeLinkedInMetrics(
      page([wrongLevel, multiDay, unknown, element]),
      { ...context, entityLevel: 'adset' },
    );

    expect(out.rows).toHaveLength(1);
    expect(out.skipped).toBe(3);
  });

  it('treats a missing metric as zero and a malformed one as a skip', () => {
    const sparse = {
      pivotValues: ['urn:li:sponsoredAccount:506333826'],
      dateRange: { start: day, end: day },
    };
    const bad = { ...sparse, costInLocalCurrency: 'abc' };
    const out = normalizeLinkedInMetrics(page([sparse, bad]), {
      ...context,
      entityLevel: 'account',
    });

    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({
      entityExternalId: '506333826',
      campaignExternalId: null,
      spend: '0.000000',
      impressions: '0',
    });
    expect(out.skipped).toBe(1);
  });

  it('carries the truncation of the read', () => {
    const out = normalizeLinkedInMetrics(page([element], true), {
      ...context,
      entityLevel: 'adset',
    });

    expect(out.truncated).toBe(true);
  });
});
