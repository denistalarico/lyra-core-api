import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import {
  LINKEDIN_ANALYTICS_FIELDS,
  LINKEDIN_PIVOT_BY_LEVEL,
  LinkedInAdsReaderService,
} from './linkedin-ads-reader.service';
import type { LinkedInAdsApiClient } from './linkedin-ads-api.client';

const credential = {
  externalAccountId: '506333826',
  accessToken: 'tok',
} as unknown as ResolvedAdCredential;

function build() {
  const get = jest.fn().mockResolvedValue({ elements: [] });
  const getPage = jest
    .fn()
    .mockResolvedValue({ elements: [], nextPageToken: null, apiCalls: 1 });
  const reader = new LinkedInAdsReaderService({
    get,
    getPage,
  } as unknown as LinkedInAdsApiClient);

  return { reader, get, getPage };
}

describe('LinkedInAdsReaderService', () => {
  it('pins the analytics fields (one invalid field fails the whole query)', () => {
    expect([...LINKEDIN_ANALYTICS_FIELDS]).toEqual([
      'dateRange',
      'pivotValues',
      'impressions',
      'clicks',
      'landingPageClicks',
      'costInLocalCurrency',
      'externalWebsiteConversions',
      'oneClickLeads',
      'videoViews',
      'conversionValueInLocalCurrency',
    ]);
    // The API accepts at most 20 metrics per call.
    expect(LINKEDIN_ANALYTICS_FIELDS.length).toBeLessThanOrEqual(20);
  });

  it('maps the Lyra levels to the documented pivots (D-I8)', () => {
    expect(LINKEDIN_PIVOT_BY_LEVEL).toEqual({
      account: 'ACCOUNT',
      campaign: 'CAMPAIGN_GROUP',
      adset: 'CAMPAIGN',
      ad: 'CREATIVE',
    });
  });

  it('asks adAnalytics for one daily level over the window, by account URN', async () => {
    const { reader, get } = build();

    await reader.readDailyMetrics(credential, 'adset', {
      since: '2026-10-17',
      until: '2026-11-15',
      days: 30,
    });

    expect(get).toHaveBeenCalledTimes(1);
    const [token, path, query] = get.mock.calls[0] as [string, string, string];
    expect(token).toBe('tok');
    expect(path).toBe('adAnalytics');
    expect(query).toContain('q=analytics');
    expect(query).toContain('pivot=CAMPAIGN');
    expect(query).toContain('timeGranularity=DAILY');
    expect(query).toContain(
      'dateRange=(start:(year:2026,month:10,day:17),end:(year:2026,month:11,day:15))',
    );
    expect(query).toContain(
      'accounts=List(urn%3Ali%3AsponsoredAccount%3A506333826)',
    );
    expect(query).toContain(`fields=${LINKEDIN_ANALYTICS_FIELDS.join(',')}`);
  });

  it('refuses a malformed window before any request', async () => {
    const { reader, get } = build();

    await expect(
      reader.readDailyMetrics(credential, 'ad', {
        since: '2026-10-17); drop',
        until: '2026-11-15',
        days: 30,
      }),
    ).rejects.toMatchObject({ code: 'linkedin_ads_bad_request' });
    expect(get).not.toHaveBeenCalled();
  });

  it('flags a full 15,000-element answer as truncated', async () => {
    const { reader, get } = build();
    get.mockResolvedValue({
      elements: Array.from({ length: 15_000 }, () => ({})),
    });

    const out = await reader.readDailyMetrics(credential, 'ad', {
      since: '2026-11-01',
      until: '2026-11-15',
      days: 15,
    });

    expect(out.truncated).toBe(true);
  });

  it('reads the hierarchy read-only and follows the page token', async () => {
    const { reader, get, getPage } = build();
    get.mockResolvedValue({ id: 506333826, name: 'Conta' });
    getPage
      .mockResolvedValueOnce({
        elements: [{ id: 1 }],
        nextPageToken: 'next',
        apiCalls: 1,
      })
      .mockResolvedValue({
        elements: [{ id: 2 }],
        nextPageToken: null,
        apiCalls: 1,
      });

    const out = await reader.readHierarchy(credential);

    expect(get).toHaveBeenCalledWith('tok', 'adAccounts/506333826', '');
    const paths = getPage.mock.calls.map((call) => call[1]);
    expect(paths).toContain('adAccounts/506333826/adCampaignGroups');
    expect(paths).toContain('adAccounts/506333826/adCampaigns');
    expect(paths).toContain('adAccounts/506333826/creatives');
    // First collection needed two pages: 2 rows, 2 calls.
    expect(out.campaignGroups.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(out.campaignGroups.apiCalls).toBe(2);
    expect(getPage.mock.calls[1][3]).toBe('next');
  });
});
