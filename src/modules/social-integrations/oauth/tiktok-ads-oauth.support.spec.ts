import {
  buildTikTokAuthorizationUrl,
  requireTikTokAdsCallbackUrl,
} from './tiktok-ads-oauth.support';

describe('TikTok Ads OAuth support', () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it('keeps the registered callback verbatim, trailing slash included (U2)', () => {
    process.env = {
      ...env,
      SOCIAL_TIKTOK_ADS_OAUTH_CALLBACK_URL:
        'https://api.example.com/api/social/integrations/tiktok-ads/callback/',
    };

    expect(requireTikTokAdsCallbackUrl()).toBe(
      'https://api.example.com/api/social/integrations/tiktok-ads/callback/',
    );
  });

  it('builds the advertiser authorization URL with app id, state and redirect', () => {
    const url = buildTikTokAuthorizationUrl({
      appId: 'app',
      callbackUrl: 'https://api.example.com/cb/',
      state: 's1',
    });

    expect(url.origin + url.pathname).toBe(
      'https://business-api.tiktok.com/portal/auth',
    );
    expect(url.searchParams.get('app_id')).toBe('app');
    expect(url.searchParams.get('state')).toBe('s1');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.example.com/cb/',
    );
  });
});
