import { randomUUID } from 'node:crypto';
import { AgencyDataSource } from '../../../../database/agency-typeorm.datasource';
import { SocialGoogleYoutubeProduct1804200000000 } from '../../../../database/migrations/1804200000000-social-google-youtube-product';
import { describePostgresIntegration } from '../../../../testing/postgres-integration';
import { YoutubeDataRetentionService } from './youtube-data-retention.service';

const run = describePostgresIntegration();
const NOW = new Date('2026-11-21T03:30:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

/** Assumes a migrated test database (social organic and Google OAuth tables). */
run('YoutubeDataRetentionService against PostgreSQL', () => {
  const tenantId = randomUUID();
  let service: YoutubeDataRetentionService;

  /** One channel in its own workspace, optionally backed by a Google link. */
  async function channel(input: {
    assetStatus?: string;
    google?: 'connected' | 'reauth_required' | null;
    reauthAt?: Date;
  }) {
    const workspaceId = randomUUID();
    const connectionId = randomUUID();
    const assetId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO social_organic_connections
         (id, tenant_id, workspace_id, provider, authorization_method, connection_status)
       VALUES ($1, $2, $3, 'youtube', 'google_oauth', 'connected')`,
      [connectionId, tenantId, workspaceId],
    );
    await AgencyDataSource.query(
      `INSERT INTO social_organic_assets
         (id, tenant_id, workspace_id, connection_id, provider, asset_type,
          external_asset_id, display_name, username, avatar_url, status)
       VALUES ($1, $2, $3, $4, 'youtube', 'youtube_channel', $5, 'Canal', '@canal',
               'https://yt.example/a.jpg', $6)`,
      [
        assetId,
        tenantId,
        workspaceId,
        connectionId,
        `UC-${assetId}`,
        input.assetStatus ?? 'active',
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
          asset_timezone)
       VALUES ($1, $2, $3, 'youtube', 'organic', '2026-11-19', 'UTC')`,
      [tenantId, workspaceId, assetId],
    );
    return { assetId, authorizationId };
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
    service = new YoutubeDataRetentionService(AgencyDataSource);
  });

  afterAll(async () => {
    try {
      for (const table of [
        'social_organic_post_metrics_daily',
        'social_organic_account_metrics_daily',
        'social_organic_assets',
        'social_organic_connections',
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

  it('purges disconnected and long-expired channels, keeps live ones, expires stale titles', async () => {
    const live = await channel({ google: 'connected' });
    const revoked = await channel({
      assetStatus: 'revoked',
      google: 'connected',
    });
    const unlinked = await channel({ google: null });
    const expired = await channel({
      google: 'reauth_required',
      reauthAt: daysAgo(25),
    });
    const recent = await channel({
      google: 'reauth_required',
      reauthAt: daysAgo(5),
    });

    const result = await service.run(NOW);
    expect(result.purgedAssets).toBe(3);

    for (const gone of [revoked, unlinked, expired]) {
      expect(
        await count('social_organic_post_metrics_daily', gone.assetId),
      ).toBe(0);
      expect(
        await count('social_organic_account_metrics_daily', gone.assetId),
      ).toBe(0);
      const [asset] = await AgencyDataSource.query<
        Array<{ display_name: string | null; avatar_url: string | null }>
      >(
        `SELECT display_name, avatar_url FROM social_organic_assets WHERE id = $1`,
        [gone.assetId],
      );
      expect(asset).toEqual({ display_name: null, avatar_url: null });
    }
    for (const kept of [live, recent]) {
      expect(
        await count('social_organic_post_metrics_daily', kept.assetId),
      ).toBe(3);
      expect(
        await count('social_organic_account_metrics_daily', kept.assetId),
      ).toBe(1);
    }

    const titles = await AgencyDataSource.query<
      Array<{ external_publication_id: string; caption: string | null }>
    >(
      `SELECT external_publication_id, caption FROM social_organic_post_metrics_daily
        WHERE asset_id = $1 ORDER BY external_publication_id, metric_date`,
      [live.assetId],
    );
    expect(titles).toEqual([
      { external_publication_id: 'vid-live', caption: 'Título' },
      { external_publication_id: 'vid-live', caption: 'Título' },
      { external_publication_id: 'vid-old', caption: null },
    ]);

    const audits = await AgencyDataSource.query<Array<{ detail: string }>>(
      `SELECT detail FROM social_google_audit_events
        WHERE tenant_id = $1 AND event = 'youtube_data_purged' ORDER BY detail`,
      [tenantId],
    );
    expect(audits.map((a) => a.detail.split(':')[0]).sort()).toEqual([
      'disconnected',
      'disconnected',
      'reauth_expired',
    ]);

    // Idempotent: nothing left to purge on the next night.
    expect((await service.run(NOW)).purgedAssets).toBe(0);
  });
});
