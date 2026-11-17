import { SocialOrganicOAuthRefreshError } from '../../connections/social-organic-oauth.provider';
import {
  TiktokBusinessApiError,
  type TiktokBusinessApiClient,
} from './tiktok-business-api.client';
import { TiktokBusinessOAuthProvider } from './tiktok-business-oauth.provider';

const ENV = {
  SOCIAL_TIKTOK_BUSINESS_APP_ID: 'app-1',
  SOCIAL_TIKTOK_BUSINESS_APP_SECRET: 'shh',
  SOCIAL_TIKTOK_ACCOUNT_AUTHORIZATION_URL:
    'https://www.tiktok.com/v2/auth/authorize?client_key=app-1&scope=user.info.basic,video.publish&response_type=code&redirect_uri=https%3A%2F%2Fapi.example.com%2Fcb%2F',
  SOCIAL_TIKTOK_ACCOUNT_OAUTH_CALLBACK_URL: 'https://api.example.com/cb/',
};

describe('TiktokBusinessOAuthProvider', () => {
  const saved = { ...process.env };
  beforeEach(() => Object.assign(process.env, ENV));
  afterEach(() => {
    process.env = { ...saved };
  });

  function build(overrides: Record<string, jest.Mock> = {}) {
    const api = {
      exchangeCode: jest.fn(),
      tokenInfo: jest
        .fn()
        .mockResolvedValue({ businessId: 'biz-1', scopes: [] }),
      profile: jest.fn().mockResolvedValue({
        username: 'lyra',
        displayName: 'Lyra',
        profileImage: 'https://p16/a.jpg',
        followersCount: 1,
      }),
      refresh: jest.fn(),
      revoke: jest.fn(),
      ...overrides,
    };
    return {
      api,
      provider: new TiktokBusinessOAuthProvider(
        api as unknown as TiktokBusinessApiClient,
      ),
    };
  }

  it('is a distinct oauth_user provider and keeps the portal URL, adding state', () => {
    const { provider } = build();
    expect(provider.configuration.provider).toBe('tiktok_business');
    expect(provider.configuration.authorizationMethod).toBe('oauth_user');
    const url = provider.buildAuthorizationUrl({ state: 's1' });
    expect(url.searchParams.get('client_key')).toBe('app-1');
    expect(url.searchParams.get('state')).toBe('s1');
    expect(provider.configuration.callbackUrl.toString()).toBe(
      'https://api.example.com/cb/',
    );
  });

  it('refuses a callback URL without the trailing slash TikTok requires', () => {
    process.env.SOCIAL_TIKTOK_ACCOUNT_OAUTH_CALLBACK_URL =
      'https://api.example.com/cb';
    const { provider } = build();
    expect(() => provider.configuration.callbackUrl).toThrow(/ending with/);
  });

  it('discovers the authorizing account through the token inspector and profile', async () => {
    const { api, provider } = build();
    await expect(
      provider.discoverAssets({ accessToken: 'at' }),
    ).resolves.toEqual([
      expect.objectContaining({
        externalAssetId: 'biz-1',
        assetType: 'tiktok_business_account',
        displayName: 'Lyra',
        username: 'lyra',
        avatarUrl: 'https://p16/a.jpg',
      }),
    ]);
    expect(api.profile).toHaveBeenCalledWith({
      accessToken: 'at',
      businessId: 'biz-1',
    });
  });

  it('treats an expired or invalid refresh token as a lost grant, anything else as transient', async () => {
    const expired = build({
      refresh: jest
        .fn()
        .mockRejectedValue(new TiktokBusinessApiError(200, 40103)),
    });
    await expect(
      expired.provider.refreshAccessToken({
        loginConfig: { appId: 'a', secret: 's' },
        refreshToken: 'r',
      }),
    ).rejects.toEqual(new SocialOrganicOAuthRefreshError('permanent'));
    const down = build({
      refresh: jest
        .fn()
        .mockRejectedValue(new TiktokBusinessApiError(503, null)),
    });
    await expect(
      down.provider.refreshAccessToken({
        loginConfig: { appId: 'a', secret: 's' },
        refreshToken: 'r',
      }),
    ).rejects.toEqual(new SocialOrganicOAuthRefreshError('transient'));
  });
});
