import { SocialOrganicOAuthRefreshError } from '../../connections/social-organic-oauth.provider';
import { TiktokApiError, type TiktokApiClient } from './tiktok-api.client';
import { TiktokOrganicOAuthProvider } from './tiktok-organic-oauth.provider';

function build(api: Partial<Record<keyof TiktokApiClient, jest.Mock>>) {
  return new TiktokOrganicOAuthProvider(api as unknown as TiktokApiClient);
}

describe('TiktokOrganicOAuthProvider', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('is an oauth_user provider with the closed scope list', () => {
    const { configuration } = build({});
    expect(configuration.provider).toBe('tiktok');
    expect(configuration.authorizationMethod).toBe('oauth_user');
    expect([...configuration.scopes]).toEqual([
      'user.info.basic',
      'user.info.stats',
      'video.publish',
      'video.list',
    ]);
  });

  it('boots unconfigured and fails only when connect is used', () => {
    delete process.env.SOCIAL_TIKTOK_CLIENT_KEY;
    expect(() => build({}).configuration.loginConfig).toThrow(
      'SOCIAL_TIKTOK_CLIENT_KEY is not configured.',
    );
  });

  it('builds the documented authorization URL', () => {
    const url = build({}).buildAuthorizationUrl({
      loginConfig: { clientKey: 'ck', clientSecret: 'cs' },
      callbackUrl: new URL('https://api.x/cb'),
      state: 's',
    });
    expect(url.origin + url.pathname).toBe(
      'https://www.tiktok.com/v2/auth/authorize/',
    );
    expect(url.searchParams.get('client_key')).toBe('ck');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe(
      'user.info.basic,user.info.stats,video.publish,video.list',
    );
    expect(url.searchParams.get('state')).toBe('s');
    expect(url.toString()).not.toContain('cs');
  });

  it('discovers the authorizing account as one tiktok_account asset', async () => {
    const provider = build({
      userInfo: jest.fn().mockResolvedValue({
        openId: 'o1',
        displayName: 'Nome',
        avatarUrl: 'a',
        followerCount: 1,
        followingCount: 1,
        likesCount: 1,
        videoCount: 1,
      }),
    });
    const assets = await provider.discoverAssets({ accessToken: 't' });
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      externalAssetId: 'o1',
      assetType: 'tiktok_account',
      displayName: 'Nome',
    });
  });

  it('refresh: rotated token on success, permanent only on invalid_grant', async () => {
    const refresh = jest
      .fn()
      .mockResolvedValueOnce({
        accessToken: 'at2',
        refreshToken: 'rt2',
        expiresIn: 7200,
        scopes: ['video.list'],
        openId: 'o',
      })
      .mockRejectedValueOnce(new TiktokApiError(400, 'invalid_grant'))
      .mockRejectedValueOnce(new TiktokApiError(400, 'invalid_request'))
      .mockRejectedValueOnce(new TiktokApiError(503, 'network'));
    const provider = build({ refresh });
    const ok = await provider.refreshAccessToken({
      loginConfig: {},
      refreshToken: 'rt',
    });
    expect(ok.refreshToken).toBe('rt2');
    expect(ok.tokenExpiresAt).toBeInstanceOf(Date);

    const kinds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await provider
        .refreshAccessToken({ loginConfig: {}, refreshToken: 'rt' })
        .catch((e: SocialOrganicOAuthRefreshError) => kinds.push(e.kind));
    }
    expect(kinds).toEqual(['permanent', 'transient', 'transient']);
  });
});
