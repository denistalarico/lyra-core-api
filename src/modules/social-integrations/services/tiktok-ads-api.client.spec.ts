import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TikTokAdsApiClient } from './tiktok-ads-api.client';

function reply(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe('TikTokAdsApiClient', () => {
  const env = process.env;
  let fetchMock: jest.SpyInstance;
  const client = new TikTokAdsApiClient();

  beforeEach(() => {
    process.env = {
      ...env,
      SOCIAL_TIKTOK_BUSINESS_APP_ID: 'app',
      SOCIAL_TIKTOK_BUSINESS_APP_SECRET: 'sec',
    };
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    process.env = env;
    fetchMock.mockRestore();
  });

  it('sends the token in Access-Token, never in the URL, and JSON-encodes lists', async () => {
    fetchMock.mockReturnValue(reply({ code: 0, data: { list: [] } }));

    await client.get('secret-token-123', 'campaign/get/', {
      advertiser_id: '700',
      fields: ['campaign_id'],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      'https://business-api.tiktok.com/open_api/v1.3/campaign/get/',
    );
    expect(decodeURIComponent(url)).toContain('fields=["campaign_id"]');
    expect(url).not.toContain('secret-token-123');
    expect(init.headers).toMatchObject({
      'Access-Token': 'secret-token-123',
    });
  });

  it.each([
    [40105, 'auth', 'tiktok_ads_reauth_required'],
    [40001, 'auth', 'tiktok_ads_permission_denied'],
    [40100, 'rate_limited', 'tiktok_ads_rate_limited'],
    [50000, 'transient', 'tiktok_ads_transient'],
    [40002, 'permanent', 'tiktok_ads_bad_request'],
  ])(
    'treats envelope code %i as %s even with HTTP 200',
    async (code, kind, safe) => {
      fetchMock.mockReturnValue(
        reply({ code, message: 'advertiser 700 secret' }),
      );

      const error = await client.get('tok', 'ad/get/', {}).catch((e) => e);

      expect(error).toMatchObject({ kind, code: safe, apiCalls: 1 });
      expect(JSON.stringify(error)).not.toContain('secret');
    },
  );

  it('exchanges the auth code with app id and secret in a JSON body', async () => {
    fetchMock.mockReturnValue(
      reply({
        code: 0,
        data: { access_token: 'AT', advertiser_ids: ['700', 701, 'x'] },
      }),
    );

    const grant = await client.exchangeCode('authc');

    expect(grant).toEqual({
      accessToken: 'AT',
      advertiserIds: ['700', '701'],
      expiresIn: null,
      refreshToken: null,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/',
    );
    expect(JSON.parse(String(init.body))).toEqual({
      app_id: 'app',
      secret: 'sec',
      auth_code: 'authc',
    });
  });

  it('keeps an IANA zone and drops one the runtime cannot use', () => {
    expect(
      client.toAdvertiser('1', { display_timezone: 'America/Sao_Paulo' })
        .timezone,
    ).toBe('America/Sao_Paulo');
    expect(
      client.toAdvertiser('1', {
        display_timezone: 'GMT-03:00',
        timezone: 'Etc/GMT+3',
      }).timezone,
    ).toBe('Etc/GMT+3');
    expect(
      client.toAdvertiser('1', { timezone: 'nowhere' }).timezone,
    ).toBeNull();
  });

  it('has no mutation path: the only POST is the token exchange', () => {
    const source = readFileSync(
      join(__dirname, 'tiktok-ads-api.client.ts'),
      'utf8',
    );

    expect(source.match(/'POST'/g)).toHaveLength(2); // the type and the one call
    expect(source).not.toMatch(/\/(update|create|delete|status\/update)\//);
  });
});
