import { SocialAdSyncConfigService } from '../services/social-ad-sync-config.service';
import { LinkedInAdsError } from './linkedin-ads-error';
import { classifySocialAdSyncRetry } from './social-ad-sync-retry';
import {
  describeSocialAdSyncFailure,
  mapSocialAdSyncError,
} from './social-ad-sync.http-error';
import { HttpException } from '@nestjs/common';

describe('LinkedIn Ads failures in the sync queue', () => {
  it('maps the four kinds to the three queue actions', () => {
    const decide = (kind: ConstructorParameters<typeof LinkedInAdsError>[0]) =>
      classifySocialAdSyncRetry(new LinkedInAdsError(kind, `code_${kind}`));

    expect(decide('transient').action).toBe('backoff');
    expect(decide('rate_limited').action).toBe('rate_limit');
    expect(decide('auth').action).toBe('stop');
    expect(decide('permanent').action).toBe('stop');
    expect(decide('auth').code).toBe('code_auth');
  });

  it('exposes a safe code and a fixed message over HTTP', () => {
    const failure = describeSocialAdSyncFailure(
      new LinkedInAdsError('auth', 'linkedin_ads_reauth_required'),
    );

    expect(failure).toMatchObject({
      status: 409,
      code: 'linkedin_ads_reauth_required',
      message: 'LinkedIn Ads could not complete the request.',
    });
    expect(
      mapSocialAdSyncError(new LinkedInAdsError('transient', 'x')),
    ).toBeInstanceOf(HttpException);
  });
});

describe('LinkedIn Ads sync switch', () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it('is off unless explicitly enabled', () => {
    const config = new SocialAdSyncConfigService();

    process.env = { ...env };
    delete process.env.SOCIAL_LINKEDIN_ADS_SYNC_ENABLED;
    expect(config.linkedInAdsEnabled).toBe(false);

    process.env.SOCIAL_LINKEDIN_ADS_SYNC_ENABLED = 'false';
    expect(config.linkedInAdsEnabled).toBe(false);

    process.env.SOCIAL_LINKEDIN_ADS_SYNC_ENABLED = 'true';
    expect(config.linkedInAdsEnabled).toBe(true);
  });
});
