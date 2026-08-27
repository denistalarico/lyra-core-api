import {
  SOCIAL_ADS_SYNC_DAILY_LOOKBACK_DAYS_ENV,
  SOCIAL_ADS_SYNC_ENABLED_ENV,
  SocialAdSyncConfigService,
} from './social-ad-sync-config.service';

describe('SocialAdSyncConfigService', () => {
  const original = { ...process.env };
  let config: SocialAdSyncConfigService;

  beforeEach(() => {
    config = new SocialAdSyncConfigService();
    delete process.env[SOCIAL_ADS_SYNC_ENABLED_ENV];
    delete process.env[SOCIAL_ADS_SYNC_DAILY_LOOKBACK_DAYS_ENV];
  });

  afterAll(() => {
    process.env = original;
  });

  it('runs by default', () => {
    // A deployment that never heard of this variable should behave like a
    // working product, not like one with its sync switched off.
    expect(config.enabled).toBe(true);
  });

  it('turns off only for a value that means off', () => {
    for (const value of ['false', 'FALSE', '0', 'no', 'off', ' False ']) {
      process.env[SOCIAL_ADS_SYNC_ENABLED_ENV] = value;
      expect(config.enabled).toBe(false);
    }
  });

  it('reads anything else as on', () => {
    // The failure mode of a typo reading as "off" is a silently dead sync that
    // nobody notices until a month of history is missing.
    for (const value of ['true', '1', 'yes', '', 'flase', 'disabled?']) {
      process.env[SOCIAL_ADS_SYNC_ENABLED_ENV] = value;
      expect(config.enabled).toBe(true);
    }
  });

  it('reads the current process environment on every call', () => {
    // What this does and does not mean. It means a caller that changes
    // `process.env` — a test, or a future runtime setting with one place to
    // intercept — sees the new value without rebuilding the service. It does
    // *not* mean an edit to the `.env` file reaches a running process:
    // `process.env` was populated at start-up and nothing re-reads the file.
    // Changing the switch in production is an edit plus a restart.
    process.env[SOCIAL_ADS_SYNC_ENABLED_ENV] = 'false';
    expect(config.enabled).toBe(false);

    process.env[SOCIAL_ADS_SYNC_ENABLED_ENV] = 'true';
    expect(config.enabled).toBe(true);
  });

  it('looks back a week by default', () => {
    expect(config.dailyLookbackDays).toBe(7);
  });

  it('takes a configured lookback', () => {
    process.env[SOCIAL_ADS_SYNC_DAILY_LOOKBACK_DAYS_ENV] = '14';
    expect(config.dailyLookbackDays).toBe(14);
  });

  it('clamps a lookback the window validator would refuse', () => {
    // A value above the 90-day limit would produce a run that fails every
    // morning, and the failure would be filed against the connection rather
    // than against the configuration that caused it.
    process.env[SOCIAL_ADS_SYNC_DAILY_LOOKBACK_DAYS_ENV] = '365';
    expect(config.dailyLookbackDays).toBe(90);

    process.env[SOCIAL_ADS_SYNC_DAILY_LOOKBACK_DAYS_ENV] = '0';
    expect(config.dailyLookbackDays).toBe(1);
  });

  it('falls back rather than guessing at nonsense', () => {
    for (const value of ['seven', '7.5', '']) {
      process.env[SOCIAL_ADS_SYNC_DAILY_LOOKBACK_DAYS_ENV] = value;
      expect(config.dailyLookbackDays).toBe(7);
    }
  });
});
