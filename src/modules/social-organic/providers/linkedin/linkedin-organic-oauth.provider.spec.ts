import {
  LinkedInOrganicApiError,
  type LinkedInOrganicApiClient,
} from './linkedin-organic-api.client';
import { LinkedInOrganicOAuthProvider } from './linkedin-organic-oauth.provider';

function build(api: Record<string, jest.Mock> = {}) {
  return new LinkedInOrganicOAuthProvider(
    api as unknown as LinkedInOrganicApiClient,
  );
}

describe('LinkedInOrganicOAuthProvider', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('is an oauth_user provider with the closed CMA scope list', () => {
    const { configuration } = build();
    expect(configuration.provider).toBe('linkedin');
    expect(configuration.authorizationMethod).toBe('oauth_user');
    expect([...configuration.scopes]).toEqual([
      'w_organization_social',
      'r_organization_social',
      'rw_organization_admin',
    ]);
  });

  it('boots unconfigured and never falls back to the Ads app', () => {
    delete process.env.SOCIAL_LINKEDIN_CLIENT_ID;
    process.env.SOCIAL_LINKEDIN_ADS_CLIENT_ID = 'ads';
    expect(() => build().configuration.loginConfig).toThrow(
      'SOCIAL_LINKEDIN_CLIENT_ID is not configured.',
    );
  });

  it('builds the authorization URL with space-separated scopes', () => {
    const url = build().buildAuthorizationUrl({
      loginConfig: { clientId: 'cid', clientSecret: 'sec' },
      callbackUrl: new URL('https://api.x/cb'),
      state: 's',
    });
    expect(url.origin + url.pathname).toBe(
      'https://www.linkedin.com/oauth/v2/authorization',
    );
    expect(url.searchParams.get('scope')).toBe(
      'w_organization_social r_organization_social rw_organization_admin',
    );
    expect(url.toString()).not.toContain('sec');
  });

  it('discovers administered pages and stamps the UTC reporting timezone', async () => {
    const provider = build({
      administeredOrganizationIds: jest.fn().mockResolvedValue(['10']),
      organization: jest
        .fn()
        .mockResolvedValue({ id: '10', name: 'Lyra', vanityName: 'lyra' }),
    });
    await expect(
      provider.discoverAssets({ accessToken: 't' }),
    ).resolves.toEqual([
      expect.objectContaining({
        externalAssetId: '10',
        assetType: 'linkedin_organization',
        displayName: 'Lyra',
        username: 'lyra',
      }),
    ]);
    await expect(provider.prepareAsset()).resolves.toEqual({
      assetTimezone: 'UTC',
      metadata: {},
    });
  });

  it('refresh is permanent only for a revoked grant', async () => {
    const refresh = jest
      .fn()
      .mockRejectedValueOnce(new LinkedInOrganicApiError(400, 'grant_revoked'))
      .mockRejectedValueOnce(
        new LinkedInOrganicApiError(400, 'invalid_request'),
      );
    const provider = build({ refresh });
    const kinds: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      await provider
        .refreshAccessToken({ loginConfig: {}, refreshToken: 'r' })
        .catch((e: { kind: string }) => kinds.push(e.kind));
    }
    expect(kinds).toEqual(['permanent', 'transient']);
  });
});
