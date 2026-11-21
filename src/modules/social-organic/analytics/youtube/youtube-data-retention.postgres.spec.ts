import { randomUUID } from 'node:crypto';
import { AgencyDataSource } from '../../../../database/agency-typeorm.datasource';
import { SocialGoogleYoutubeProduct1804200000000 } from '../../../../database/migrations/1804200000000-social-google-youtube-product';
import { describePostgresIntegration } from '../../../../testing/postgres-integration';
import { SocialOrganicAssetEntity } from '../../entities';
import { YoutubeOrganicHealthService } from '../../providers/youtube/youtube-organic-health.service';
import { YoutubeDataRetentionService } from './youtube-data-retention.service';

const run = describePostgresIntegration();
const NOW = new Date('2026-11-21T03:30:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

/** Assumes a migrated test database (social organic, Google OAuth, analytics). */
run('YouTube data retention against PostgreSQL', () => {
  const tenantId = randomUUID();
  const files = { deleteObject: jest.fn().mockResolvedValue(undefined) };
  let service: YoutubeDataRetentionService;

  type Channel = {
    assetId: string;
    workspaceId: string;
    authorizationId: string | null;
  };

  /** One channel in its own workspace, optionally backed by a Google link. */
  async function channel(input: {
    assetStatus?: string;
    google?: 'connected' | 'reauth_required' | null;
    reauthAt?: Date;
    confirmedAt?: Date | null;
    updatedAt?: Date;
  }): Promise<Channel> {
    const workspaceId = randomUUID();
    const connectionId = randomUUID();
    const assetId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO social_organic_connections
         (id, tenant_id, workspace_id, provider, authorization_method, connection_status)
       VALUES ($1, $2, $3, 'youtube', 'google_oauth', 'connected')`,
      [connectionId, tenantId, workspaceId],
    );
    const confirmedAt =
      input.confirmedAt === undefined ? daysAgo(1) : input.confirmedAt;
    await AgencyDataSource.query(
      `INSERT INTO social_organic_assets
         (id, tenant_id, workspace_id, connection_id, provider, asset_type,
          external_asset_id, display_name, username, avatar_url, status,
          metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'youtube', 'youtube_channel', $5, 'Canal', '@canal',
               'https://yt.example/a.jpg', $6, $7, $8, $9)`,
      [
        assetId,
        tenantId,
        workspaceId,
        connectionId,
        `UC-${assetId}`,
        input.assetStatus ?? 'active',
        confirmedAt
          ? {
              youtubeConfirmedAt: confirmedAt.toISOString(),
              youtubeVideosVerifiedAt: confirmedAt.toISOString(),
            }
          : {},
        daysAgo(90),
        input.updatedAt ?? daysAgo(1),
      ],
    );
    let authorizationId: string | null = null;
    if (input.google) {
      authorizationId = randomUUID();
      await AgencyDataSource.query(
        `INSERT INTO social_google_authorizations
           (id, tenant_id, workspace_id, google_sub, status, connected_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [
          authorizationId,
          tenantId,
          workspaceId,
          `sub-${assetId}`,
          input.google,
        ],
      );
      await AgencyDataSource.query(
        `INSERT INTO social_google_product_links
           (authorization_id, tenant_id, product, status)
         VALUES ($1, $2, 'youtube', 'connected')`,
        [authorizationId, tenantId],
      );
      if (input.reauthAt) {
        await AgencyDataSource.query(
          `INSERT INTO social_google_audit_events
             (tenant_id, authorization_id, event, created_at)
           VALUES ($1, $2, 'reauth_required', $3)`,
          [tenantId, authorizationId, input.reauthAt],
        );
      }
    }
    for (const [video, day, syncedAt] of [
      ['vid-old', '2026-09-01', daysAgo(60)],
      ['vid-live', '2026-09-01', daysAgo(60)],
      ['vid-live', '2026-11-19', daysAgo(1)],
    ] as const) {
      await AgencyDataSource.query(
        `INSERT INTO social_organic_post_metrics_daily
           (tenant_id, workspace_id, asset_id, provider, source,
            external_publication_id, metric_date, asset_timezone, caption,
            published_at, synced_at)
         VALUES ($1, $2, $3, 'youtube', 'organic', $4, $5, 'UTC', 'Título',
                 '2026-08-01T00:00:00Z', $6)`,
        [tenantId, workspaceId, assetId, video, day, syncedAt],
      );
    }
    await AgencyDataSource.query(
      `INSERT INTO social_organic_account_metrics_daily
         (tenant_id, workspace_id, asset_id, provider, source, metric_date,
          asset_timezone, followers_count)
       VALUES ($1, $2, $3, 'youtube', 'organic', '2026-11-19', 'UTC', 10)`,
      [tenantId, workspaceId, assetId],
    );
    return { assetId, workspaceId, authorizationId };
  }

  async function report(workspaceId: string, channels: string[]) {
    const id = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO social_analytics_reports
         (id, tenant_id, workspace_id, title, channels, period_since,
          period_until, page_mode, storage_key)
       VALUES ($1, $2, $3, 'R', $4, '2026-11-01', '2026-11-20', 'paginated', $5)`,
      [
        id,
        tenantId,
        workspaceId,
        JSON.stringify(channels),
        `reports/${id}.pdf`,
      ],
    );
    return id;
  }

  async function dashboard(workspaceId: string) {
    const id = randomUUID();
    const card = (kind: string, n: number) => ({
      id: `${kind}-${n}`,
      kind,
      size: { w: 1, h: 1 },
    });
    await AgencyDataSource.query(
      `INSERT INTO social_analytics_dashboards (id, tenant_id, workspace_id, name, layout)
       VALUES ($1, $2, $3, 'D', $4)`,
      [
        id,
        tenantId,
        workspaceId,
        {
          version: 1,
          sections: [
            {
              id: 's1',
              channel: 'youtube',
              title: 'YT',
              cards: [card('kpi', 1), card('insight', 2), card('chart', 3)],
            },
            {
              id: 's2',
              channel: 'meta_ads',
              title: 'Ads',
              cards: [card('insight', 4)],
            },
          ],
        },
      ],
    );
    return id;
  }

  const count = async (table: string, assetId: string) =>
    Number(
      (
        await AgencyDataSource.query<Array<{ n: string }>>(
          `SELECT count(*) AS n FROM ${table} WHERE asset_id = $1`,
          [assetId],
        )
      )[0].n,
    );

  const asset = async (assetId: string) =>
    (
      await AgencyDataSource.query<
        Array<{
          display_name: string | null;
          avatar_url: string | null;
          last_health_status: string | null;
          metadata: Record<string, string>;
        }>
      >(
        `SELECT display_name, avatar_url, last_health_status, metadata
           FROM social_organic_assets WHERE id = $1`,
        [assetId],
      )
    )[0];

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    // Idempotent: admits the `youtube` product even on a lagging test database.
    const queryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await new SocialGoogleYoutubeProduct1804200000000().up(queryRunner);
    } finally {
      await queryRunner.release();
    }
    service = new YoutubeDataRetentionService(AgencyDataSource, files as never);
  });

  afterAll(async () => {
    try {
      for (const table of [
        'social_organic_post_metrics_daily',
        'social_organic_account_metrics_daily',
        'social_organic_assets',
        'social_organic_connections',
        'social_analytics_reports',
        'social_analytics_dashboards',
        'social_google_audit_events',
        'social_google_product_links',
        'social_google_authorizations',
      ]) {
        await AgencyDataSource.query(
          `DELETE FROM ${table} WHERE tenant_id = $1`,
          [tenantId],
        );
      }
    } finally {
      if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
    }
  });

  it('purges by rule, keeps live channels, cleans reports and insights, and expires stale details', async () => {
    const live = await channel({ google: 'connected' });
    const revoked = await channel({
      assetStatus: 'revoked',
      google: 'connected',
    });
    const unlinked = await channel({ google: null });
    // Refusal seen 2 days ago, but last confirmed 21 days ago: past 20.
    const expired = await channel({
      google: 'reauth_required',
      reauthAt: daysAgo(2),
      confirmedAt: daysAgo(21),
    });
    const recent = await channel({
      google: 'reauth_required',
      reauthAt: daysAgo(2),
      confirmedAt: daysAgo(3),
    });
    const unverified = await channel({
      google: 'connected',
      confirmedAt: daysAgo(26),
    });
    // Never stamped, row untouched for 40 days: only its channel details go.
    const legacy = await channel({
      google: 'connected',
      confirmedAt: null,
      updatedAt: daysAgo(40),
    });

    const revokedReports = [
      await report(revoked.workspaceId, ['youtube', 'ga4']),
      await report(revoked.workspaceId, ['summary']),
    ];
    const keptReport = await report(revoked.workspaceId, ['meta_ads']);
    const liveReport = await report(live.workspaceId, ['youtube']);
    const revokedDashboard = await dashboard(revoked.workspaceId);
    const liveDashboard = await dashboard(live.workspaceId);

    const result = await service.run(NOW);
    expect(result.purgedAssets).toBe(4);

    for (const gone of [revoked, unlinked, expired, unverified]) {
      expect(
        await count('social_organic_post_metrics_daily', gone.assetId),
      ).toBe(0);
      expect(
        await count('social_organic_account_metrics_daily', gone.assetId),
      ).toBe(0);
      expect(await asset(gone.assetId)).toMatchObject({
        display_name: null,
        avatar_url: null,
        metadata: {},
      });
    }
    for (const kept of [live, recent, legacy]) {
      expect(
        await count('social_organic_post_metrics_daily', kept.assetId),
      ).toBe(3);
      expect(
        await count('social_organic_account_metrics_daily', kept.assetId),
      ).toBe(1);
    }
    expect((await asset(live.assetId)).display_name).toBe('Canal');
    expect((await asset(legacy.assetId)).display_name).toBeNull();

    // Reports: YouTube and summary ones of the purged context go, file first.
    const reports = await AgencyDataSource.query<Array<{ id: string }>>(
      `SELECT id FROM social_analytics_reports WHERE tenant_id = $1 ORDER BY id`,
      [tenantId],
    );
    expect(reports.map((r) => r.id).sort()).toEqual(
      [keptReport, liveReport].sort(),
    );
    expect(
      files.deleteObject.mock.calls.map(([arg]) => arg.path).sort(),
    ).toEqual(revokedReports.map((id) => `reports/${id}.pdf`).sort());

    // Insight cards: dropped from the purged context's YouTube section only.
    const layouts = await AgencyDataSource.query<
      Array<{
        id: string;
        layout: { sections: Array<{ cards: Array<{ id: string }> }> };
      }>
    >(
      `SELECT id, layout FROM social_analytics_dashboards WHERE tenant_id = $1`,
      [tenantId],
    );
    const cards = (id: string) =>
      layouts
        .find((d) => d.id === id)!
        .layout.sections.map((s) => s.cards.map((c) => c.id));
    expect(cards(revokedDashboard)).toEqual([
      ['kpi-1', 'chart-3'],
      ['insight-4'],
    ]);
    expect(cards(liveDashboard)).toEqual([
      ['kpi-1', 'insight-2', 'chart-3'],
      ['insight-4'],
    ]);

    // Titles: a recently verified channel keeps them; an unverified one (no
    // videos stamp) loses those of videos no sync refreshed for 30 days.
    const titles = await AgencyDataSource.query<
      Array<{ external_publication_id: string; caption: string | null }>
    >(
      `SELECT external_publication_id, caption FROM social_organic_post_metrics_daily
        WHERE asset_id = $1 ORDER BY external_publication_id, metric_date`,
      [legacy.assetId],
    );
    expect(titles.map((t) => t.caption)).toEqual(['Título', 'Título', null]);
    expect(
      (
        await AgencyDataSource.query<Array<{ n: string }>>(
          `SELECT count(*) AS n FROM social_organic_post_metrics_daily
            WHERE asset_id = $1 AND caption IS NULL`,
          [live.assetId],
        )
      )[0].n,
    ).toBe('0');

    const audits = await AgencyDataSource.query<Array<{ detail: string }>>(
      `SELECT detail FROM social_google_audit_events
        WHERE tenant_id = $1 AND event = 'youtube_data_purged'`,
      [tenantId],
    );
    expect(audits.map((a) => a.detail.split(':')[0]).sort()).toEqual([
      'disconnected',
      'disconnected',
      'reauth_expired',
      'unverified',
    ]);

    // Idempotent: nothing left to purge on the next night.
    files.deleteObject.mockClear();
    expect((await service.run(NOW)).purgedAssets).toBe(0);
    expect(files.deleteObject).not.toHaveBeenCalled();
  });

  it('leaves a purge with a failed report deletion for the next run', async () => {
    const gone = await channel({ assetStatus: 'revoked', google: 'connected' });
    await report(gone.workspaceId, ['youtube']);
    files.deleteObject.mockRejectedValueOnce(new Error('r2_down'));
    await expect(service.purgeAsset(gone.assetId, NOW)).rejects.toThrow(
      'r2_down',
    );
    expect(await count('social_organic_post_metrics_daily', gone.assetId)).toBe(
      3,
    );
    await expect(service.purgeAsset(gone.assetId, NOW)).resolves.toBe(4);
  });

  describe('YoutubeOrganicHealthService', () => {
    function health(input: {
      channels?: Array<{ channelId: string }>;
      videos?: string[];
      tokenError?: Error;
    }) {
      const credentials = {
        resolveGoogleDiscoveryToken: input.tokenError
          ? jest.fn().mockRejectedValue(input.tokenError)
          : jest.fn().mockResolvedValue('token'),
      };
      const google = {
        listYoutubeChannels: jest.fn().mockResolvedValue(
          (input.channels ?? []).map((c) => ({
            ...c,
            title: 'Canal novo',
            customUrl: '@novo',
            thumbnailUrl: 'https://yt.example/b.jpg',
          })),
        ),
      };
      const youtube = {
        videoDetails: jest.fn().mockResolvedValue({
          details: (input.videos ?? []).map((videoId) => ({
            videoId,
            title: `Novo ${videoId}`,
            publishedAt: new Date('2026-08-02T00:00:00Z'),
          })),
          apiCalls: 1,
        }),
      };
      return new YoutubeOrganicHealthService(
        AgencyDataSource,
        credentials as never,
        google as never,
        youtube as never,
      );
    }
    const entity = (assetId: string) =>
      AgencyDataSource.getRepository(SocialOrganicAssetEntity).findOneByOrFail({
        id: assetId,
      });

    it('reconfirms the channel, refreshes its details and drops deleted videos', async () => {
      const ch = await channel({
        google: 'connected',
        confirmedAt: daysAgo(10),
      });
      const row = await entity(ch.assetId);
      const outcome = await health({
        channels: [{ channelId: row.externalAssetId }],
        videos: ['vid-live'],
      }).runCheck(row, NOW);
      expect(outcome).toBe('healthy');
      const after = await asset(ch.assetId);
      expect(after).toMatchObject({
        display_name: 'Canal novo',
        avatar_url: 'https://yt.example/b.jpg',
        last_health_status: 'healthy',
      });
      expect(after.metadata.youtubeConfirmedAt).toBe(NOW.toISOString());
      expect(after.metadata.youtubeVideosVerifiedAt).toBe(NOW.toISOString());
      const rows = await AgencyDataSource.query<
        Array<{ external_publication_id: string; caption: string }>
      >(
        `SELECT external_publication_id, caption FROM social_organic_post_metrics_daily
          WHERE asset_id = $1`,
        [ch.assetId],
      );
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.caption === 'Novo vid-live')).toBe(true);
    });

    it('marks a channel the account no longer reaches unhealthy, without a new stamp', async () => {
      const ch = await channel({
        google: 'connected',
        confirmedAt: daysAgo(10),
      });
      const outcome = await health({ channels: [] }).runCheck(
        await entity(ch.assetId),
        NOW,
      );
      expect(outcome).toBe('unhealthy');
      const after = await asset(ch.assetId);
      expect(after.last_health_status).toBe('unhealthy');
      expect(after.metadata.youtubeConfirmedAt).toBe(daysAgo(10).toISOString());
    });

    it('deletes nothing when every stored video comes back missing', async () => {
      const ch = await channel({ google: 'connected' });
      const row = await entity(ch.assetId);
      const outcome = await health({
        channels: [{ channelId: row.externalAssetId }],
        videos: [],
      }).runCheck(row, NOW);
      expect(outcome).toBe('skipped_anomaly');
      expect(await count('social_organic_post_metrics_daily', ch.assetId)).toBe(
        3,
      );
    });

    it('only checks live channels not checked in the last day', async () => {
      const due = await channel({ google: 'connected' });
      const gone = await channel({
        assetStatus: 'revoked',
        google: 'connected',
      });
      const eligible = (
        await health({}).listEligibleForScheduledCheck(NOW)
      ).map((a) => a.id);
      expect(eligible).toContain(due.assetId);
      expect(eligible).not.toContain(gone.assetId);
    });
  });
});
