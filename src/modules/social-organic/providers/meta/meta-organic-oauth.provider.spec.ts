/* eslint-disable @typescript-eslint/require-await -- provider doubles intentionally return resolved async values. */
import type { MetaOrganicAssetDiscoveryService } from './meta-organic-asset-discovery.service';
import type { MetaOrganicGraphService } from './meta-organic-graph.service';
import { MetaOrganicOAuthProvider } from './meta-organic-oauth.provider';
import { SOCIAL_META_ORGANIC_SCOPES } from './meta-organic-oauth.support';

describe('MetaOrganicOAuthProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SOCIAL_META_APP_ID: 'social-app',
      SOCIAL_META_APP_SECRET: 'social-secret',
      SOCIAL_META_ORGANIC_LOGIN_CONFIG_ID: '1072508992158703',
      SOCIAL_META_ORGANIC_OAUTH_CALLBACK_URL:
        'https://api.lyrasuite.com/api/social/organic/oauth/meta/callback',
      APP_FRONTEND_URL: 'https://lyrasuite.com',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function harness(options: { longLivedFails?: boolean } = {}) {
    const graph = {
      getLoginConfig: jest.fn(() => ({
        appId: 'social-app',
        configId: '1072508992158703',
        authorizationEndpoint: 'https://www.facebook.com/v24.0/dialog/oauth',
      })),
      exchangeOAuthCode: jest.fn(async () => ({
        accessToken: 'short-token',
        expiresIn: 3600,
      })),
      exchangeLongLivedToken: options.longLivedFails
        ? jest.fn(async () => Promise.reject(new Error('provider-secret')))
        : jest.fn(async () => ({
            accessToken: 'long-token',
            expiresIn: 5_184_000,
          })),
      revokePermissions: jest.fn(async () => undefined),
    };
    const discovery = {
      discover: jest.fn(async () => []),
      prepare: jest.fn(async () => ({ accessToken: 'page-token' })),
    };
    return {
      graph,
      discovery,
      provider: new MetaOrganicOAuthProvider(
        graph as unknown as MetaOrganicGraphService,
        discovery as unknown as MetaOrganicAssetDiscoveryService,
      ),
    };
  }

  it('builds the Organic authorization URL and preserves state', () => {
    const { provider } = harness();
    const config = provider.configuration;
    const url = provider.buildAuthorizationUrl({
      loginConfig: config.loginConfig,
      callbackUrl: config.callbackUrl,
      state: 'single-use-state',
    });

    expect(url.searchParams.get('client_id')).toBe('social-app');
    expect(url.searchParams.get('config_id')).toBe('1072508992158703');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.lyrasuite.com/api/social/organic/oauth/meta/callback',
    );
    expect(url.searchParams.get('state')).toBe('single-use-state');
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('declares Facebook Login for Business and exactly the MA1 + MA1.1 scopes', () => {
    const { provider } = harness();
    expect(provider.configuration.provider).toBe('meta');
    expect(provider.configuration.authorizationMethod).toBe('oauth_business');
    expect(provider.configuration.scopes).toEqual([
      'business_management',
      'pages_show_list',
      'pages_read_engagement',
      'instagram_basic',
      'pages_manage_posts',
      'instagram_content_publish',
    ]);
  });

  it('the persisted scope contract (config_id-applied, not a URL param) contains exactly the 6 expected scopes', () => {
    expect(SOCIAL_META_ORGANIC_SCOPES).toHaveLength(6);
    expect([...SOCIAL_META_ORGANIC_SCOPES].sort()).toEqual(
      [
        'business_management',
        'pages_show_list',
        'pages_read_engagement',
        'instagram_basic',
        'pages_manage_posts',
        'instagram_content_publish',
      ].sort(),
    );
  });

  it('includes both MA1.1 publishing scopes', () => {
    expect(SOCIAL_META_ORGANIC_SCOPES).toContain('pages_manage_posts');
    expect(SOCIAL_META_ORGANIC_SCOPES).toContain('instagram_content_publish');
  });

  it('never requests Ads scopes', () => {
    for (const forbidden of [
      'ads_management',
      'ads_read',
      'pages_manage_ads',
      'catalog_management',
    ]) {
      expect(SOCIAL_META_ORGANIC_SCOPES).not.toContain(forbidden);
    }
  });

  it('never requests Messaging/Inbox scopes', () => {
    for (const forbidden of [
      'pages_messaging',
      'pages_messaging_subscriptions',
      'whatsapp_business_management',
      'whatsapp_business_messaging',
    ]) {
      expect(SOCIAL_META_ORGANIC_SCOPES).not.toContain(forbidden);
    }
  });

  it('never requests comments/insights/admin scopes reserved for future capability work', () => {
    for (const forbidden of [
      'pages_manage_engagement',
      'pages_manage_metadata',
      'pages_read_user_content',
      'read_insights',
      'instagram_manage_comments',
      'instagram_manage_contents',
      'instagram_manage_engagement',
      'instagram_manage_insights',
    ]) {
      expect(SOCIAL_META_ORGANIC_SCOPES).not.toContain(forbidden);
    }
  });

  it('does not serialize scopes into the authorization URL — Facebook Login for Business applies them via config_id', () => {
    const { provider } = harness();
    const config = provider.configuration;
    const url = provider.buildAuthorizationUrl({
      loginConfig: config.loginConfig,
      callbackUrl: config.callbackUrl,
      state: 'single-use-state',
    });

    expect(url.searchParams.has('scope')).toBe(false);
    expect(url.searchParams.get('config_id')).toBe('1072508992158703');
  });

  it('normalizes the long-lived exchange', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-07T12:00:00Z'));
    const { provider } = harness();

    await expect(
      provider.exchangeCode({
        loginConfig: provider.configuration.loginConfig,
        callbackUrl: provider.configuration.callbackUrl,
        code: 'code',
      }),
    ).resolves.toEqual({
      accessToken: 'long-token',
      refreshToken: null,
      tokenExpiresAt: new Date('2026-11-06T12:00:00Z'),
      scopes: SOCIAL_META_ORGANIC_SCOPES,
    });
    jest.useRealTimers();
  });

  it('keeps the short-lived grant when extension is not applicable', async () => {
    const { provider } = harness({ longLivedFails: true });
    const grant = await provider.exchangeCode({
      loginConfig: provider.configuration.loginConfig,
      callbackUrl: provider.configuration.callbackUrl,
      code: 'code',
    });

    expect(grant.accessToken).toBe('short-token');
    expect(grant.tokenExpiresAt).toBeInstanceOf(Date);
  });

  it('delegates discovery, preparation and revocation hooks', async () => {
    const { provider, discovery, graph } = harness();
    await provider.discoverAssets({ accessToken: 'user-token' });
    await provider.prepareAsset({
      accessToken: 'user-token',
      asset: { externalAssetId: 'page-1', assetType: 'facebook_page' },
    });
    await provider.revokeAuthorization({
      connectionAccessToken: 'user-token',
      refreshToken: null,
      assets: [],
    });

    expect(discovery.discover).toHaveBeenCalledWith('user-token');
    expect(discovery.prepare).toHaveBeenCalled();
    expect(graph.revokePermissions).toHaveBeenCalledWith('user-token');
  });
});
