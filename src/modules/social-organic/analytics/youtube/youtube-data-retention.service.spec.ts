import {
  YOUTUBE_REAUTH_GRACE_DAYS,
  YoutubeDataRetentionService,
  youtubeDataRetentionEnabled,
  youtubePurgeReason,
} from './youtube-data-retention.service';

const NOW = new Date('2026-11-21T03:30:00Z');
const DAY = 86_400_000;
const live = {
  assetId: 'asset-1',
  tenantId: 'tenant-1',
  organicActive: true,
  authorizationId: 'auth-1',
  authorizationStatus: 'connected',
  reauthSince: null,
};

describe('youtubePurgeReason', () => {
  it('keeps a live channel', () => {
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

  it('waits the grace period after reauth_required, then purges', () => {
    const reauth = { ...live, authorizationStatus: 'reauth_required' };
    const within = new Date(
      NOW.getTime() - (YOUTUBE_REAUTH_GRACE_DAYS - 1) * DAY,
    );
    const past = new Date(NOW.getTime() - YOUTUBE_REAUTH_GRACE_DAYS * DAY);
    expect(youtubePurgeReason({ ...reauth, reauthSince: within }, NOW)).toBe(
      null,
    );
    expect(youtubePurgeReason({ ...reauth, reauthSince: past }, NOW)).toBe(
      'reauth_expired',
    );
    // Unknown start: the clock starts now, never an immediate purge.
    expect(youtubePurgeReason(reauth, NOW)).toBeNull();
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

describe('YoutubeDataRetentionService.purgeAsset', () => {
  function build(candidate: Record<string, unknown> | undefined) {
    const manager = {
      query: jest.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes('FROM social_organic_assets a')) {
          return candidate ? [candidate] : [];
        }
        if (sql.startsWith('DELETE')) return [[], 3];
        return [];
      }),
    };
    const dataSource = {
      transaction: (work: (m: typeof manager) => unknown) => work(manager),
    };
    return {
      manager,
      service: new YoutubeDataRetentionService(dataSource as never),
    };
  }

  it('deletes metrics, scrubs the channel and audits the purge', async () => {
    const { service, manager } = build({ ...live, organicActive: false });
    await expect(service.purgeAsset('asset-1', NOW)).resolves.toBe(6);
    const sql = manager.query.mock.calls.map(([s]) => s);
    expect(sql.filter((s) => s.startsWith('DELETE'))).toEqual([
      'DELETE FROM social_organic_post_metrics_daily WHERE asset_id = $1',
      'DELETE FROM social_organic_account_metrics_daily WHERE asset_id = $1',
    ]);
    expect(sql.some((s) => s.includes('display_name = NULL'))).toBe(true);
    const audit = manager.query.mock.calls.find(([s]) =>
      String(s).includes('youtube_data_purged'),
    )!;
    expect(audit[1]).toEqual([
      'tenant-1',
      'auth-1',
      'disconnected:asset=asset-1',
    ]);
  });

  it('does nothing when the channel became live again under the lock', async () => {
    const { service, manager } = build(live);
    await expect(service.purgeAsset('asset-1', NOW)).resolves.toBeNull();
    expect(manager.query).toHaveBeenCalledTimes(1);
  });
});
