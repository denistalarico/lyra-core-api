import {
  SOCIAL_PUBLICATION_ENABLED_ENV,
  SocialPublicationConfigService,
} from './social-publication-config.service';

describe('SocialPublicationConfigService', () => {
  const original = { ...process.env };
  const provider = 'meta-facebook';
  let config: SocialPublicationConfigService;

  beforeEach(() => {
    config = new SocialPublicationConfigService();
    delete process.env[SOCIAL_PUBLICATION_ENABLED_ENV];
    delete process.env[config.providerEnabledEnv(provider)];
  });

  afterAll(() => {
    process.env = original;
  });

  it('disables publishing when the global gate is unset or empty', () => {
    expect(config.enabled).toBe(false);

    process.env[SOCIAL_PUBLICATION_ENABLED_ENV] = '';
    expect(config.enabled).toBe(false);
  });

  it('enables only explicit recognized global values', () => {
    for (const value of ['true', '1', 'yes', 'on', ' TRUE ']) {
      process.env[SOCIAL_PUBLICATION_ENABLED_ENV] = value;
      expect(config.enabled).toBe(true);
    }

    for (const value of ['false', '0', 'no', 'off', 'enabled', '']) {
      process.env[SOCIAL_PUBLICATION_ENABLED_ENV] = value;
      expect(config.enabled).toBe(false);
    }
  });

  it('keeps provider gates independent from the global gate', () => {
    const providerEnv = config.providerEnabledEnv(provider);
    process.env[SOCIAL_PUBLICATION_ENABLED_ENV] = 'false';
    process.env[providerEnv] = 'true';

    expect(config.enabled).toBe(false);
    expect(config.isProviderEnabled(provider)).toBe(true);

    process.env[SOCIAL_PUBLICATION_ENABLED_ENV] = 'true';
    delete process.env[providerEnv];

    expect(config.enabled).toBe(true);
    expect(config.isProviderEnabled(provider)).toBe(false);
  });

  it('normalizes provider keys without requiring a provider enum', () => {
    expect(config.providerEnabledEnv(' Meta / Facebook ')).toBe(
      'SOCIAL_PUBLICATION_META_FACEBOOK_ENABLED',
    );
  });
});
