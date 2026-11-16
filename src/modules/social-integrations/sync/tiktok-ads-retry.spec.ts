import { HttpException } from '@nestjs/common';
import { SocialAdSyncConfigService } from '../services/social-ad-sync-config.service';
import { classifySocialAdSyncRetry } from './social-ad-sync-retry';
import {
  describeSocialAdSyncFailure,
  mapSocialAdSyncError,
} from './social-ad-sync.http-error';
import { TikTokAdsError } from './tiktok-ads-error';

describe('TikTok Ads failures in the sync queue', () => {
  it('maps the four kinds to the three queue actions', () => {
    const decide = (kind: ConstructorParameters<typeof TikTokAdsError>[0]) =>
      classifySocialAdSyncRetry(new TikTokAdsError(kind, `code_${kind}`));

    expect(decide('transient').action).toBe('backoff');
    expect(decide('rate_limited').action).toBe('rate_limit');
    expect(decide('auth').action).toBe('stop');
    expect(decide('permanent').action).toBe('stop');
  });

  it('exposes a safe code and a fixed message over HTTP', () => {
    expect(
      describeSocialAdSyncFailure(
        new TikTokAdsError('auth', 'tiktok_ads_reauth_required'),
      ),
    ).toMatchObject({
      status: 409,
      code: 'tiktok_ads_reauth_required',
      message: 'TikTok Ads could not complete the request.',
    });
    expect(
      mapSocialAdSyncError(new TikTokAdsError('transient', 'x')),
    ).toBeInstanceOf(HttpException);
  });

  it('keeps the sync switch off unless explicitly enabled', () => {
    const env = process.env;
    const config = new SocialAdSyncConfigService();

    process.env = { ...env };
    delete process.env.SOCIAL_TIKTOK_ADS_SYNC_ENABLED;
    expect(config.tikTokAdsEnabled).toBe(false);
    process.env.SOCIAL_TIKTOK_ADS_SYNC_ENABLED = 'true';
    expect(config.tikTokAdsEnabled).toBe(true);
    process.env = env;
  });
});
