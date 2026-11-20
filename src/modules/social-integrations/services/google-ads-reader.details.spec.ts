import type { GoogleAdsCredentialResolver } from '../../social-google/google-ads-credential.resolver';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { GoogleAdsReaderService } from './google-ads-reader.service';
import type { SocialAdSyncConfigService } from './social-ad-sync-config.service';

const CREDENTIAL = {
  connectionId: 'c',
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: null,
  provider: 'google_ads',
  externalAccountId: '1234567890',
  accessToken: 'test-access-token',
} as unknown as ResolvedAdCredential;

const WINDOW = { since: '2026-11-01', until: '2026-11-07', days: 7 };

function build() {
  const config = {
    googleAdsDailyOperationBudget: 100,
  } as SocialAdSyncConfigService;
  const resolver = {
    loginCustomerId: jest.fn(async () => null),
  } as unknown as GoogleAdsCredentialResolver;
  return new GoogleAdsReaderService(config, resolver);
}

function captureQueries() {
  const fetchSpy = jest
    .spyOn(global, 'fetch')
    .mockImplementation(
      async () => new Response(JSON.stringify([{ results: [] }])),
    );
  return () =>
    fetchSpy.mock.calls.map(
      ([, init]) =>
        JSON.parse(String((init as RequestInit).body)).query as string,
    );
}

describe('GoogleAdsReaderService — campaign details (GA-DET)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads the channel split FROM campaign with the channel type alongside', async () => {
    const queries = captureQueries();
    await build().readCampaignDetail(CREDENTIAL, 'ad_network', WINDOW);
    expect(queries()[0]).toBe(
      "SELECT campaign.id, campaign.advertising_channel_type, segments.date, segments.ad_network_type, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '2026-11-01' AND '2026-11-07'",
    );
  });

  it('reads conversion actions with conversion metrics only', async () => {
    const queries = captureQueries();
    await build().readCampaignDetail(CREDENTIAL, 'conversion_action', WINDOW);
    expect(queries()[0]).not.toMatch(
      /metrics\.(cost_micros|impressions|clicks)\b/,
    );
  });

  it('reads PMax categories for one campaign, without cost', async () => {
    const queries = captureQueries();
    await build().readPmaxSearchCategories(CREDENTIAL, '24460619718', WINDOW);
    expect(queries()[0]).toBe(
      "SELECT campaign_search_term_insight.category_label, segments.date, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign_search_term_insight WHERE segments.date BETWEEN '2026-11-01' AND '2026-11-07' AND campaign_search_term_insight.campaign_id = '24460619718'",
    );
  });

  it('refuses a campaign id that is not digits before any request', async () => {
    const queries = captureQueries();
    await expect(
      build().readPmaxSearchCategories(CREDENTIAL, "1' OR '1'='1", WINDOW),
    ).rejects.toMatchObject({ code: 'google_ads_bad_request' });
    expect(queries()).toHaveLength(0);
  });

  it('refuses a malformed window before any request', async () => {
    const queries = captureQueries();
    await expect(
      build().readCampaignDetail(CREDENTIAL, 'search_term', {
        since: "2026-11-01' OR '1'='1",
        until: '2026-11-07',
        days: 7,
      }),
    ).rejects.toMatchObject({ code: 'google_ads_bad_request' });
    expect(queries()).toHaveLength(0);
  });

  it('spends one operation per detail read', async () => {
    captureQueries();
    const page = await build().readCampaignDetail(
      CREDENTIAL,
      'keyword',
      WINDOW,
    );
    expect(page.apiCalls).toBe(1);
  });
});
