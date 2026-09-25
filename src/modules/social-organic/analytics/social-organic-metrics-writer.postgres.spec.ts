import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { CreateSocialOrganicConnections1791500000000 } from '../../../database/migrations/1791500000000-create-social-organic-connections';
import { CreateSocialOrganicReadModel1791900000000 } from '../../../database/migrations/1791900000000-create-social-organic-read-model';
import { MakeSocialOrganicMetricsNullable1792100000000 } from '../../../database/migrations/1792100000000-make-social-organic-metrics-nullable';
import { AddSocialOrganicPostLifetimeSnapshots1792400000000 } from '../../../database/migrations/1792400000000-add-social-organic-post-lifetime-snapshots';
import { AddSocialOrganicPostIdentity1795400000000 } from '../../../database/migrations/1795400000000-add-social-organic-post-identity';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import type {
  NormalizedOrganicAccountMetricDaily,
  NormalizedOrganicPostMetricDaily,
} from './social-organic-insights.contract';
import { SocialOrganicMetricsWriterService } from './social-organic-metrics-writer.service';

const run = describePostgresIntegration();

run('SocialOrganicMetricsWriterService against PostgreSQL', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const connectionId = randomUUID();
  const assetId = randomUUID();
  const firstRunId = randomUUID();
  const secondRunId = randomUUID();
  let service: SocialOrganicMetricsWriterService;

  const account = (
    overrides: Partial<NormalizedOrganicAccountMetricDaily> = {},
  ): NormalizedOrganicAccountMetricDaily => ({
    tenantId,
    workspaceId,
    agencyClientId: null,
    assetId,
    provider: 'meta',
    source: 'organic',
    metricDate: '2026-09-08',
    assetTimezone: 'America/Sao_Paulo',
    followersCount: '9007199254740993',
    followersGained: null,
    followersLost: null,
    impressions: '10',
    reach: null,
    viewsTotal: null,
    reachTotal: null,
    profileViews: null,
    totalInteractions: null,
    accountsEngaged: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    replies: null,
    pageFollows: null,
    pageDailyFollows: null,
    pageDailyUnfollows: null,
    viewsOrganic: null,
    viewsPaid: null,
    newConversations: null,
    isPartial: true,
    syncedAt: new Date('2026-09-08T15:00:00.000Z'),
    syncRunId: firstRunId,
    providerMetrics: { views: { value: '10' } },
    ...overrides,
  });

  const post = (
    overrides: Partial<NormalizedOrganicPostMetricDaily> = {},
  ): NormalizedOrganicPostMetricDaily => ({
    tenantId,
    workspaceId,
    agencyClientId: null,
    assetId,
    provider: 'meta',
    source: 'organic',
    externalPublicationId: 'post-1',
    publicationId: null,
    metricDate: '2026-09-08',
    assetTimezone: 'America/Sao_Paulo',
    impressions: null,
    reach: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    videoViews: null,
    watchTimeSeconds: null,
    linkClicks: null,
    profileVisits: null,
    impressionsLifetime: null,
    impressionsLifetimeObservedAt: null,
    likesLifetime: null,
    likesLifetimeObservedAt: null,
    commentsLifetime: null,
    commentsLifetimeObservedAt: null,
    videoViewsLifetime: null,
    videoViewsLifetimeObservedAt: null,
    reachLifetime: null,
    savesLifetime: null,
    sharesLifetime: null,
    totalInteractionsLifetime: null,
    profileVisitsLifetime: null,
    followsLifetime: null,
    reelsAvgWatchTimeMs: null,
    reelsTotalWatchTimeMs: null,
    reelsSkipRateBp: null,
    repostsLifetime: null,
    reactionsTotal: null,
    reactionsLike: null,
    reactionsLove: null,
    reactionsWow: null,
    reactionsHaha: null,
    reactionsSorry: null,
    reactionsAnger: null,
    viewsOrganicLifetime: null,
    viewsPaidLifetime: null,
    lifetimeObservedAt: null,
    permalink: null,
    caption: null,
    mediaType: null,
    mediaProductType: null,
    publishedAt: null,
    isPartial: true,
    syncedAt: new Date('2026-09-08T15:00:00.000Z'),
    syncRunId: firstRunId,
    providerMetrics: {},
    ...overrides,
  });

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    const queryRunner: QueryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await new CreateSocialOrganicConnections1791500000000().up(queryRunner);
      await new CreateSocialOrganicReadModel1791900000000().up(queryRunner);
      await new MakeSocialOrganicMetricsNullable1792100000000().up(queryRunner);
      await new AddSocialOrganicPostLifetimeSnapshots1792400000000().up(
        queryRunner,
      );
      await new AddSocialOrganicPostIdentity1795400000000().up(queryRunner);
    } finally {
      await queryRunner.release();
    }

    await AgencyDataSource.query(
      `INSERT INTO social_organic_connections
         (id, tenant_id, workspace_id, provider, authorization_method)
       VALUES ($1, $2, $3, 'meta', 'oauth_user')`,
      [connectionId, tenantId, workspaceId],
    );
    await AgencyDataSource.query(
      `INSERT INTO social_organic_assets
         (id, tenant_id, workspace_id, connection_id, provider, asset_type,
          external_asset_id)
       VALUES ($1, $2, $3, $4, 'meta', 'facebook_page', $5)`,
      [assetId, tenantId, workspaceId, connectionId, `external-${assetId}`],
    );
    for (const runId of [firstRunId, secondRunId]) {
      await AgencyDataSource.query(
        `INSERT INTO social_organic_sync_runs
           (id, tenant_id, workspace_id, asset_id, provider, run_kind,
            idempotency_key)
         VALUES ($1, $2, $3, $4, 'meta', 'manual', $5)`,
        [runId, tenantId, workspaceId, assetId, `writer-${runId}`],
      );
    }

    service = new SocialOrganicMetricsWriterService(AgencyDataSource);
  });

  afterAll(async () => {
    try {
      await AgencyDataSource.query(
        `DELETE FROM social_organic_post_metrics_daily WHERE asset_id = $1`,
        [assetId],
      );
      await AgencyDataSource.query(
        `DELETE FROM social_organic_account_metrics_daily WHERE asset_id = $1`,
        [assetId],
      );
      await AgencyDataSource.query(
        `DELETE FROM social_organic_sync_runs WHERE asset_id = $1`,
        [assetId],
      );
      await AgencyDataSource.query(
        `DELETE FROM social_organic_assets WHERE id = $1`,
        [assetId],
      );
      await AgencyDataSource.query(
        `DELETE FROM social_organic_connections WHERE id = $1`,
        [connectionId],
      );
    } finally {
      if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
    }
  });

  beforeEach(async () => {
    await AgencyDataSource.query(
      `DELETE FROM social_organic_post_metrics_daily WHERE asset_id = $1`,
      [assetId],
    );
    await AgencyDataSource.query(
      `DELETE FROM social_organic_account_metrics_daily WHERE asset_id = $1`,
      [assetId],
    );
  });

  it('converges repeated writes, preserves bigint and does not recalculate timezone', async () => {
    await service.upsert({ accountRows: [account()], postRows: [] });
    await service.upsert({
      accountRows: [
        account({
          followersCount: '9007199254740995',
          impressions: '12',
          reach: '7',
          assetTimezone: 'Asia/Tokyo',
          syncRunId: secondRunId,
          isPartial: false,
          providerMetrics: { reach: { value: '7' } },
        }),
      ],
      postRows: [],
    });

    const rows = await AgencyDataSource.query<Array<Record<string, unknown>>>(
      `SELECT followers_count::text, impressions::text, reach::text,
              asset_timezone, is_partial, sync_run_id,
              provider_metrics
         FROM social_organic_account_metrics_daily
        WHERE asset_id = $1 AND metric_date = '2026-09-08'`,
      [assetId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      followers_count: '9007199254740995',
      impressions: '12',
      reach: '7',
      asset_timezone: 'America/Sao_Paulo',
      is_partial: false,
      sync_run_id: secondRunId,
      provider_metrics: {
        views: { value: '10' },
        reach: { value: '7' },
      },
    });
  });

  it('stores the ads-inclusive total beside the organic figure, never merging them', async () => {
    // The numbers are the shape production showed on 2026-09-24: the organic
    // slice is a small fraction of the account's total because almost all the
    // delivery was paid. Writing only the organic one is what made the
    // dashboard show 509 where Meta's own app showed 9.155.
    await service.upsert({
      accountRows: [
        account({
          impressions: '509',
          reach: '138',
          viewsTotal: '9155',
          reachTotal: '6783',
        }),
      ],
      postRows: [],
    });

    const rows = await AgencyDataSource.query<Array<Record<string, unknown>>>(
      `SELECT impressions::text, reach::text,
              views_total::text, reach_total::text
         FROM social_organic_account_metrics_daily
        WHERE asset_id = $1 AND metric_date = '2026-09-08'`,
      [assetId],
    );

    expect(rows[0]).toMatchObject({
      impressions: '509',
      reach: '138',
      views_total: '9155',
      reach_total: '6783',
    });

    // The four are four separate measurements. The total is not the sum of the
    // slices, and nothing in the write derives one from another.
    expect(rows[0].views_total).not.toBe(rows[0].impressions);
    expect(rows[0].reach_total).not.toBe(rows[0].reach);
  });

  it('never regresses a stored total to NULL on a later partial write', async () => {
    // Same COALESCE rule the lifetime columns follow: a sync that could not
    // read the total must leave yesterday's reading alone rather than erase it.
    await service.upsert({
      accountRows: [account({ viewsTotal: '9155', reachTotal: '6783' })],
      postRows: [],
    });
    await service.upsert({
      accountRows: [
        account({
          viewsTotal: null,
          reachTotal: null,
          syncRunId: secondRunId,
        }),
      ],
      postRows: [],
    });

    const rows = await AgencyDataSource.query<Array<Record<string, unknown>>>(
      `SELECT views_total::text, reach_total::text
         FROM social_organic_account_metrics_daily
        WHERE asset_id = $1 AND metric_date = '2026-09-08'`,
      [assetId],
    );

    expect(rows[0]).toMatchObject({
      views_total: '9155',
      reach_total: '6783',
    });
  });

  it('rolls back the whole attempted write and preserves existing facts on failure', async () => {
    await service.upsert({ accountRows: [account()], postRows: [] });

    await expect(
      service.upsert({
        accountRows: [account({ impressions: '99' })],
        postRows: [post({ impressions: '-1' })],
      }),
    ).rejects.toBeDefined();

    const rows = await AgencyDataSource.query<Array<{ impressions: string }>>(
      `SELECT impressions::text
         FROM social_organic_account_metrics_daily
        WHERE asset_id = $1 AND metric_date = '2026-09-08'`,
      [assetId],
    );
    expect(rows).toEqual([{ impressions: '10' }]);
  });

  it('COALESCEs the lifetime snapshot columns on conflict, never regressing a real value to NULL', async () => {
    const observedAt = new Date('2026-09-08T15:00:00.000Z');
    await service.upsert({
      accountRows: [],
      postRows: [
        post({
          impressionsLifetime: '42',
          impressionsLifetimeObservedAt: observedAt,
          likesLifetime: '9',
          likesLifetimeObservedAt: observedAt,
        }),
      ],
    });

    // A same-day resync that reports a fresh impressions value but omits
    // likes (NULL) must not erase the previously observed likes value.
    const laterObservedAt = new Date('2026-09-08T18:00:00.000Z');
    await service.upsert({
      accountRows: [],
      postRows: [
        post({
          impressionsLifetime: '50',
          impressionsLifetimeObservedAt: laterObservedAt,
          likesLifetime: null,
          likesLifetimeObservedAt: null,
          syncRunId: secondRunId,
        }),
      ],
    });

    const rows = await AgencyDataSource.query<Array<Record<string, unknown>>>(
      `SELECT impressions_lifetime::text, impressions_lifetime_observed_at,
              likes_lifetime::text, likes_lifetime_observed_at
         FROM social_organic_post_metrics_daily
        WHERE asset_id = $1 AND external_publication_id = 'post-1'
          AND metric_date = '2026-09-08'`,
      [assetId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].impressions_lifetime).toBe('50');
    expect(rows[0].likes_lifetime).toBe('9');
  });
});
