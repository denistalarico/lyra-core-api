/* eslint-disable @typescript-eslint/require-await -- provider doubles intentionally return resolved async values. */
import type { MetaInstagramAssetDiscoveryService } from './meta-instagram-asset-discovery.service';
import type { MetaOrganicGraphService } from './meta-organic-graph.service';
import { MetaInstagramOAuthProvider } from './meta-instagram-oauth.provider';
import { SOCIAL_META_INSTAGRAM_SCOPES } from './meta-organic-oauth.support';

describe('MetaInstagramOAuthProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SOCIAL_META_APP_ID: 'social-app',
      SOCIAL_META_APP_SECRET: 'social-secret',
      SOCIAL_META_ORGANIC_OAUTH_CALLBACK_URL:
        'https://api.lyrasuite.com/api/social/organic/oauth/meta/callback',
      APP_FRONTEND_URL: 'https://lyrasuite.com',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function harness() {
    const graph = {
      getInstagramLoginConfig: jest.fn(() => ({
        appId: 'social-app',
        authorizationEndpoint: 'https://www.instagram.com/oauth/authorize',
      })),
      exchangeInstagramOAuthCode: jest.fn(async () => ({
        accessToken: 'short-token',
        expiresIn: 3600,
      })),
      exchangeInstagramLongLivedToken: jest.fn(async () => ({
        accessToken: 'long-token',
        expiresIn: 5_184_000,
      })),
      revokePermissions: jest.fn(async () => undefined),
    };
    const discovery = {
      discover: jest.fn(async () => []),
      prepare: jest.fn(async () => ({ accessToken: null })),
    };
    return {
      graph,
      discovery,
      provider: new MetaInstagramOAuthProvider(
        graph as unknown as MetaOrganicGraphService,
        discovery as unknown as MetaInstagramAssetDiscoveryService,
      ),
    };
  }

  it('uses Instagram Login, not Facebook Login for Business or Ads', () => {
    const { provider } = harness();
    const config = provider.configuration;
    const url = provider.buildAuthorizationUrl({
      loginConfig: config.loginConfig,
      callbackUrl: config.callbackUrl,
      state: 'single-use-state',
    });

    expect(provider.configuration.provider).toBe('instagram');
    expect(provider.configuration.authorizationMethod).toBe('oauth_user');
    expect(url.origin).toBe('https://www.instagram.com');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('social-app');
    expect(url.searchParams.get('config_id')).toBeNull();
    expect(url.searchParams.get('scope')).toBe(
      SOCIAL_META_INSTAGRAM_SCOPES.join(','),
    );
  });

  it('keeps a direct Instagram credential on the connection', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-17T21:00:00Z'));
    const { provider } = harness();

    await expect(
      provider.exchangeCode({
        loginConfig: provider.configuration.loginConfig,
        callbackUrl: provider.configuration.callbackUrl,
        code: 'authorization-code',
      }),
    ).resolves.toEqual({
      accessToken: 'long-token',
      refreshToken: null,
      tokenExpiresAt: new Date('2026-11-16T21:00:00Z'),
      scopes: SOCIAL_META_INSTAGRAM_SCOPES,
    });
    jest.useRealTimers();
  });
});
