import {
  TiktokBusinessApiClient,
  TiktokBusinessApiError,
  tiktokBusinessFailure,
} from './tiktok-business-api.client';

const app = { appId: 'app-1', secret: 'shh' };

function respond(body: unknown, status = 200) {
  return jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('TiktokBusinessApiClient', () => {
  const client = new TiktokBusinessApiClient();
  afterEach(() => jest.restoreAllMocks());

  it('exchanges the account holder code at /tt_user/oauth2/token/', async () => {
    const fetchMock = respond({
      code: 0,
      data: {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 86400,
        open_id: 'biz-1',
        scope: 'user.info.basic,video.publish',
      },
    });
    const grant = await client.exchangeCode({
      app,
      code: 'c',
      redirectUri: 'https://api.example.com/cb/',
    });
    expect(grant).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 86400,
      scopes: ['user.info.basic', 'video.publish'],
      openId: 'biz-1',
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      'https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/',
    );
    expect(JSON.parse(String(init!.body))).toEqual({
      client_id: 'app-1',
      client_secret: 'shh',
      grant_type: 'authorization_code',
      auth_code: 'c',
      redirect_uri: 'https://api.example.com/cb/',
    });
  });

  it('treats code != 0 on HTTP 200 as an error', async () => {
    respond({ code: 40105, message: 'Invalid access token' });
    await expect(
      client.videoSettings({ accessToken: 'x', businessId: 'b' }),
    ).rejects.toMatchObject({ status: 200, code: 40105 });
  });

  it('reads the business id from the token inspector', async () => {
    respond({
      code: 0,
      data: { app_id: 'app-1', creator_id: 'biz-9', scope: 'video.publish' },
    });
    await expect(client.tokenInfo({ app, accessToken: 'at' })).resolves.toEqual(
      {
        businessId: 'biz-9',
        scopes: ['video.publish'],
      },
    );
  });

  it('sends the Access-Token header and the JSON fields list to /business/get/', async () => {
    const fetchMock = respond({
      code: 0,
      data: {
        username: 'lyra',
        display_name: 'Lyra',
        profile_image: 'https://p16/x',
        followers_count: 3,
      },
    });
    await expect(
      client.profile({ accessToken: 'at', businessId: 'biz-1' }),
    ).resolves.toEqual({
      username: 'lyra',
      displayName: 'Lyra',
      profileImage: 'https://p16/x',
      followersCount: 3,
    });
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.searchParams.get('business_id')).toBe('biz-1');
    expect(JSON.parse(parsed.searchParams.get('fields')!)).toContain(
      'profile_image',
    );
    expect((init!.headers as Record<string, string>)['Access-Token']).toBe(
      'at',
    );
  });

  it('classifies documented return codes', () => {
    expect(
      tiktokBusinessFailure(new TiktokBusinessApiError(200, 40102)).reason,
    ).toBe('credential_expired');
    expect(
      tiktokBusinessFailure(new TiktokBusinessApiError(200, 40100)).reason,
    ).toBe('rate_limited');
    expect(
      tiktokBusinessFailure(new TiktokBusinessApiError(200, 40907)).reason,
    ).toBe('media_rejected');
    expect(tiktokBusinessFailure(new Error('x')).reason).toBe(
      'provider_unavailable',
    );
  });
});
