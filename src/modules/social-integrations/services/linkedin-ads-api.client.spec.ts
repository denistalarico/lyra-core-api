import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LinkedInAdsApiClient } from './linkedin-ads-api.client';

function reply(status: number, body: unknown = {}, headers = {}) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers }),
  );
}

describe('LinkedInAdsApiClient', () => {
  const env = process.env;
  let fetchMock: jest.SpyInstance;
  const client = new LinkedInAdsApiClient();

  beforeEach(() => {
    process.env = {
      ...env,
      LINKEDIN_API_VERSION: '202610',
      SOCIAL_LINKEDIN_ADS_CLIENT_ID: 'cid',
      SOCIAL_LINKEDIN_ADS_CLIENT_SECRET: 'csecret',
    };
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    process.env = env;
    fetchMock.mockRestore();
  });

  it('sends the three required headers with the version from the env', async () => {
    fetchMock.mockReturnValue(reply(200, { elements: [] }));

    await client.get('tok', 'adAnalytics', 'q=analytics');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.linkedin.com/rest/adAnalytics?q=analytics');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'Linkedin-Version': '202610',
      'X-Restli-Protocol-Version': '2.0.0',
    });
  });

  it('refuses to call without a valid LINKEDIN_API_VERSION', async () => {
    process.env.LINKEDIN_API_VERSION = 'latest';

    await expect(client.get('tok', 'adAccounts', '')).rejects.toMatchObject({
      kind: 'permanent',
      code: 'linkedin_ads_not_configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'auth', 'linkedin_ads_reauth_required'],
    [403, 'auth', 'linkedin_ads_permission_denied'],
    [429, 'rate_limited', 'linkedin_ads_rate_limited'],
    [503, 'transient', 'linkedin_ads_transient'],
    [400, 'permanent', 'linkedin_ads_bad_request'],
  ])(
    'classifies HTTP %i as %s without reading the body',
    async (status, kind, code) => {
      fetchMock.mockReturnValue(reply(status, { message: 'urn:li:secret' }));

      const error = await client.get('tok', 'adAccounts', '').catch((e) => e);

      expect(error).toMatchObject({ kind, code, apiCalls: 1 });
      expect(JSON.stringify(error)).not.toContain('urn:li:secret');
    },
  );

  it('exchanges the code with a form POST and keeps the refresh token optional', async () => {
    fetchMock.mockReturnValue(
      reply(200, { access_token: 'AQ', expires_in: 5184000 }),
    );

    const grant = await client.exchangeCode({
      code: 'c0de',
      redirectUri: 'https://api.example.com/cb',
    });

    expect(grant).toEqual({
      accessToken: 'AQ',
      expiresIn: 5184000,
      refreshToken: null,
      refreshTokenExpiresIn: null,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.linkedin.com/oauth/v2/accessToken');
    expect(String(init.body)).toContain('grant_type=authorization_code');
  });

  it('lists only active, non-test accounts and tolerates bad elements', async () => {
    fetchMock.mockReturnValue(
      reply(200, {
        elements: [
          { id: 507404993, name: 'Conta', currency: 'BRL', status: 'ACTIVE' },
          { id: 'x' },
        ],
      }),
    );

    const accounts = await client.listAdAccounts('tok');

    expect(accounts).toEqual([
      {
        externalAccountId: '507404993',
        accountName: 'Conta',
        currency: 'BRL',
        accountStatus: 'ACTIVE',
      },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'search=(status:(values:List(ACTIVE)),test:false)',
    );
  });

  it('has no mutation path: the only POST is the token exchange', () => {
    const source = readFileSync(
      join(__dirname, 'linkedin-ads-api.client.ts'),
      'utf8',
    );
    const methods = [...source.matchAll(/method:\s*'([A-Z]+)'/g)].map(
      (match) => match[1],
    );

    expect(methods.sort()).toEqual(['GET', 'POST']);
    expect(source).not.toMatch(/PATCH|DELETE|PARTIAL_UPDATE/);
  });
});
