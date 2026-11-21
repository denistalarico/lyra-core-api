import {
  YOUTUBE_REAUTH_GRACE_DAYS,
  YOUTUBE_UNVERIFIED_GRACE_DAYS,
  youtubeDataRetentionEnabled,
  youtubePurgeReason,
} from './youtube-data-retention.service';

const NOW = new Date('2026-11-21T03:30:00Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const live = {
  organicActive: true,
  authorizationId: 'auth-1',
  authorizationStatus: 'connected',
  reauthSince: null,
  confirmedAt: daysAgo(1),
};

describe('youtubePurgeReason', () => {
  it('keeps a live, recently confirmed channel', () => {
    expect(youtubePurgeReason(live, NOW)).toBeNull();
  });

  it('purges at once when the channel or its Google link is gone', () => {
    expect(youtubePurgeReason({ ...live, organicActive: false }, NOW)).toBe(
      'disconnected',
    );
    expect(
      youtubePurgeReason(
        { ...live, authorizationId: null, authorizationStatus: null },
        NOW,
      ),
    ).toBe('disconnected');
  });

  it('counts reauth_required from the last confirmation, which precedes the revocation', () => {
    const reauth = { ...live, authorizationStatus: 'reauth_required' };
    // Detected only 2 days ago, but last confirmed 20 days ago: purge now.
    expect(
      youtubePurgeReason(
        {
          ...reauth,
          confirmedAt: daysAgo(YOUTUBE_REAUTH_GRACE_DAYS),
          reauthSince: daysAgo(2),
        },
        NOW,
      ),
    ).toBe('reauth_expired');
    expect(
      youtubePurgeReason(
        {
          ...reauth,
          confirmedAt: daysAgo(YOUTUBE_REAUTH_GRACE_DAYS - 1),
          reauthSince: daysAgo(2),
        },
        NOW,
      ),
    ).toBeNull();
    // No confirmation known: the refusal itself starts the clock.
    expect(
      youtubePurgeReason(
        {
          ...reauth,
          confirmedAt: null,
          reauthSince: daysAgo(YOUTUBE_REAUTH_GRACE_DAYS),
        },
        NOW,
      ),
    ).toBe('reauth_expired');
    // Nothing known: never an immediate purge.
    expect(
      youtubePurgeReason(
        { ...reauth, confirmedAt: null, reauthSince: null },
        NOW,
      ),
    ).toBeNull();
  });

  it('purges a connected channel no check has confirmed for weeks', () => {
    expect(
      youtubePurgeReason(
        { ...live, confirmedAt: daysAgo(YOUTUBE_UNVERIFIED_GRACE_DAYS) },
        NOW,
      ),
    ).toBe('unverified');
    expect(
      youtubePurgeReason(
        { ...live, confirmedAt: daysAgo(YOUTUBE_UNVERIFIED_GRACE_DAYS - 1) },
        NOW,
      ),
    ).toBeNull();
    // Before the first stamp (legacy rows) the rule does not apply.
    expect(youtubePurgeReason({ ...live, confirmedAt: null }, NOW)).toBeNull();
  });

  it('keeps every deadline inside the YouTube 30-day limit', () => {
    expect(YOUTUBE_REAUTH_GRACE_DAYS).toBeLessThan(30);
    expect(YOUTUBE_UNVERIFIED_GRACE_DAYS).toBeLessThan(30);
  });
});

describe('youtubeDataRetentionEnabled', () => {
  const key = 'SOCIAL_YOUTUBE_DATA_RETENTION_ENABLED';
  afterEach(() => delete process.env[key]);

  it('is on unless explicitly braked', () => {
    expect(youtubeDataRetentionEnabled()).toBe(true);
    process.env[key] = 'FALSE';
    expect(youtubeDataRetentionEnabled()).toBe(false);
  });
});
