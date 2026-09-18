import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { CreateSocialOrganicConnections1791500000000 } from '../../../database/migrations/1791500000000-create-social-organic-connections';
import { CreateSocialOrganicReadModel1791900000000 } from '../../../database/migrations/1791900000000-create-social-organic-read-model';
import { MakeSocialOrganicMetricsNullable1792100000000 } from '../../../database/migrations/1792100000000-make-social-organic-metrics-nullable';
import { AddSocialOrganicPostLifetimeSnapshots1792400000000 } from '../../../database/migrations/1792400000000-add-social-organic-post-lifetime-snapshots';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { SocialOrganicAnalyticsReadService } from './social-organic-analytics-read.service';

/**
 * A3's read service, against real PostgreSQL.
 *
 * Mirrors `social-analytics-read.postgres.spec.ts`'s structure: the
 * SUM-heavy aggregation this service builds is not honestly testable against
 * a mocked query builder, so scope isolation, the stock/flow read rules, and
 * gap-day handling are all asserted against a real database inside one
 * transaction that is rolled back.
 *
 * Needs an environment with PostgreSQL access to actually run — gated by
 * `describePostgresIntegration()`, same as every other `*.postgres.spec.ts`
 * in this module.
 */
const run = describePostgresIntegration();

run('SocialOrganicAnalyticsReadService against PostgreSQL', () => {
  let queryRunner: QueryRunner;
  let service: SocialOrganicAnalyticsReadService;

  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const connectionId = randomUUID();
  const assetId = randomUUID();
  const otherTenantAssetId = randomUUID();
  const clientAssetId = randomUUID();
  const agencyClientId = randomUUID();

  const scope = { tenantId, workspaceId, agencyClientId: null };

  function insertConnection(id: string, tenant = tenantId) {
    return queryRunner.query(`
      INSERT INTO "social_organic_connections"
        ("id", "tenant_id", "workspace_id", "provider", "authorization_method")
      VALUES ('${id}', '${tenant}', '${workspaceId}', 'meta', 'oauth_user')
    `);
  }

  function insertAsset(input: {
    id: string;
    tenantId?: string;
    agencyClientId?: string | null;
    assetTimezone?: string;
  }) {
    return queryRunner.query(`
      INSERT INTO "social_organic_assets"
        ("id", "tenant_id", "workspace_id", "agency_client_id", "connection_id",
         "provider", "asset_type", "external_asset_id", "display_name",
         "asset_timezone")
      VALUES (
        '${input.id}', '${input.tenantId ?? tenantId}', '${workspaceId}',
        ${input.agencyClientId ? `'${input.agencyClientId}'` : 'NULL'},
        '${connectionId}', 'meta', 'facebook_page', 'external-${input.id}',
        'Test Page', '${input.assetTimezone ?? 'America/Sao_Paulo'}'
      )
    `);
  }

  function insertFact(input: {
    assetId?: string;
    metricDate: string;
    impressions?: string | null;
    reach?: string | null;
    followersCount?: string | null;
    followersGained?: string | null;
    followersLost?: string | null;
    profileViews?: string | null;
    isPartial?: boolean;
  }) {
    const nullable = (value: string | null | undefined, fallback: string) =>
      value === null ? 'NULL' : (value ?? fallback);

    return queryRunner.query(`
      INSERT INTO "social_organic_account_metrics_daily"
        ("tenant_id", "workspace_id", "asset_id", "provider", "source",
         "metric_date", "asset_timezone", "impressions", "reach",
         "followers_count", "followers_gained", "followers_lost",
         "profile_views", "is_partial")
      VALUES (
        '${tenantId}', '${workspaceId}', '${input.assetId ?? assetId}', 'meta',
        'organic', '${input.metricDate}', 'America/Sao_Paulo',
        ${nullable(input.impressions, '100')}, ${nullable(input.reach, '80')},
        ${nullable(input.followersCount, '500')},
        ${nullable(input.followersGained, '5')},
        ${nullable(input.followersLost, '1')},
        ${nullable(input.profileViews, '10')}, ${input.isPartial ?? false}
      )
    `);
  }

  function insertRun(input: {
    assetId?: string;
    runKind: 'manual' | 'scheduled';
    status: string;
    finishedAt?: string | null;
  }) {
    const finished = input.finishedAt ? `'${input.finishedAt}'` : 'NULL';

    return queryRunner.query(`
      INSERT INTO "social_organic_sync_runs"
        ("tenant_id", "workspace_id", "asset_id", "provider", "run_kind",
         "status", "idempotency_key", "finished_at")
      VALUES (
        '${tenantId}', '${workspaceId}', '${input.assetId ?? assetId}', 'meta',
        '${input.runKind}', '${input.status}', '${randomUUID()}', ${finished}
      )
    `);
  }

  function insertPostFact(input: {
    publicationId: string;
    metricDate: string;
    externalPublicationId?: string;
    assetId?: string;
    agencyClientId?: string | null;
    reach?: string | null;
    shares?: string | null;
    likesLifetime?: string | null;
    videoViewsLifetime?: string | null;
    isPartial?: boolean;
    syncedAt?: string;
  }) {
    const nullable = (value: string | null | undefined) =>
      value === null ? 'NULL' : (value === undefined ? 'NULL' : value);
    const observedAt = input.syncedAt ?? `${input.metricDate}T12:00:00.000Z`;
    const clientId = input.agencyClientId
      ? `'${input.agencyClientId}'`
      : 'NULL';

    return queryRunner.query(`
      INSERT INTO "social_organic_post_metrics_daily"
        ("tenant_id", "workspace_id", "agency_client_id", "asset_id",
         "provider", "source", "external_publication_id", "publication_id",
         "metric_date", "asset_timezone", "reach", "shares",
         "likes_lifetime", "likes_lifetime_observed_at",
         "video_views_lifetime", "video_views_lifetime_observed_at",
         "is_partial", "synced_at")
      VALUES (
        '${tenantId}', '${workspaceId}', ${clientId}, '${input.assetId ?? assetId}',
        'meta', 'organic', '${input.externalPublicationId ?? `external-${input.publicationId}`}',
        '${input.publicationId}', '${input.metricDate}', 'America/Sao_Paulo',
        ${nullable(input.reach)}, ${nullable(input.shares)},
        ${nullable(input.likesLifetime)},
        ${input.likesLifetime === null || input.likesLifetime === undefined ? 'NULL' : `'${observedAt}'`},
        ${nullable(input.videoViewsLifetime)},
        ${input.videoViewsLifetime === null || input.videoViewsLifetime === undefined ? 'NULL' : `'${observedAt}'`},
        ${input.isPartial ?? false}, '${observedAt}'
      )
    `);
  }

  const overview = (since: string, until: string, id = assetId) =>
    service.overview({ ...scope, assetId: id, since, until });

  const timeseries = (since: string, until: string, id = assetId) =>
    service.timeseries({ ...scope, assetId: id, since, until });

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    const setup = AgencyDataSource.createQueryRunner();
    await setup.connect();
    try {
      await new CreateSocialOrganicConnections1791500000000().up(setup);
      await new CreateSocialOrganicReadModel1791900000000().up(setup);
      await new MakeSocialOrganicMetricsNullable1792100000000().up(setup);
      await new AddSocialOrganicPostLifetimeSnapshots1792400000000().up(setup);
    } finally {
      await setup.release();
    }
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  beforeEach(async () => {
    queryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    await insertConnection(connectionId);
    await insertAsset({ id: assetId });
    await insertAsset({ id: otherTenantAssetId, tenantId: randomUUID() });
    await insertAsset({ id: clientAssetId, agencyClientId });

    const manager = queryRunner.manager;
    service = new SocialOrganicAnalyticsReadService(
      manager.getRepository('SocialOrganicAssetEntity') as never,
      manager.getRepository('SocialOrganicAccountMetricDailyEntity') as never,
      manager.getRepository('SocialOrganicPostMetricDailyEntity') as never,
      manager.getRepository('SocialOrganicSyncRunEntity') as never,
    );
  });

  afterEach(async () => {
    await queryRunner.rollbackTransaction();
    await queryRunner.release();
  });

  describe('scope isolation', () => {
    it('throws NotFoundException for another tenant/workspace/client asset', async () => {
      await expect(
        overview('2026-09-01', '2026-09-01', otherTenantAssetId),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        overview('2026-09-01', '2026-09-01', clientAssetId),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        timeseries('2026-09-01', '2026-09-01', otherTenantAssetId),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.freshness({ ...scope, assetId: otherTenantAssetId }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.listAssets(scope)).resolves.not.toContainEqual(
        expect.objectContaining({ id: otherTenantAssetId }),
      );
    });

    it('reads the agency-own (null) asset only under a null agencyClientId scope', async () => {
      await insertFact({ assetId: clientAssetId, metricDate: '2026-09-01' });

      await expect(
        service.overview({
          tenantId,
          workspaceId,
          agencyClientId,
          assetId: clientAssetId,
          since: '2026-09-01',
          until: '2026-09-01',
        }),
      ).resolves.toMatchObject({ assetId: clientAssetId });
      await expect(
        overview('2026-09-01', '2026-09-01', clientAssetId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('overview totals', () => {
    it('sums impressions/followersGained/followersLost/profileViews and marks partial data', async () => {
      await insertFact({
        metricDate: '2026-09-01',
        impressions: '100',
        followersGained: '5',
        followersLost: '1',
        profileViews: '10',
      });
      await insertFact({
        metricDate: '2026-09-02',
        impressions: '50',
        followersGained: '2',
        followersLost: '0',
        profileViews: '4',
        isPartial: true,
      });

      const result = await overview('2026-09-01', '2026-09-02');

      expect(result.totals.impressions).toBe('150');
      expect(result.totals.followersGained).toBe('7');
      expect(result.totals.followersLost).toBe('1');
      expect(result.totals.profileViews).toBe('14');
      expect(result.hasPartialData).toBe(true);
      expect(result.lastFactDate).toBe('2026-09-02');
    });

    it('returns reach only for a single-day period that reported it, null otherwise', async () => {
      await insertFact({ metricDate: '2026-09-01', reach: '80' });
      await insertFact({ metricDate: '2026-09-02', reach: '90' });

      const singleDay = await overview('2026-09-01', '2026-09-01');
      expect(singleDay.totals.reach).toBe('80');
      expect(singleDay.totals.reachGranularity).toBe('daily');

      const multiDay = await overview('2026-09-01', '2026-09-02');
      expect(multiDay.totals.reach).toBeNull();
      expect(multiDay.totals.reachGranularity).toBe('daily');
    });

    it('follows the followersCount stock rule: a non-null mid-period observation wins over a later null', async () => {
      await insertFact({
        metricDate: '2026-09-01',
        followersCount: '500',
      });
      await insertFact({
        metricDate: '2026-09-02',
        followersCount: null,
      });

      const result = await overview('2026-09-01', '2026-09-02');
      expect(result.totals.followersCount).toBe('500');
    });

    it('returns null followersCount when no observation exists in the window', async () => {
      await insertFact({ metricDate: '2026-09-01', followersCount: null });

      const result = await overview('2026-09-01', '2026-09-01');
      expect(result.totals.followersCount).toBeNull();
    });
  });

  describe('timeseries', () => {
    it('fills gap days with hasData:false and nulls, never zeros', async () => {
      await insertFact({ metricDate: '2026-09-01', impressions: '100' });
      // 2026-09-02 has no fact.
      await insertFact({ metricDate: '2026-09-03', impressions: '50' });

      const result = await timeseries('2026-09-01', '2026-09-03');

      expect(result.points).toHaveLength(3);
      expect(result.points[0]).toMatchObject({
        date: '2026-09-01',
        hasData: true,
        impressions: '100',
      });
      expect(result.points[1]).toMatchObject({
        date: '2026-09-02',
        hasData: false,
        impressions: null,
        reach: null,
      });
      expect(result.points[2]).toMatchObject({
        date: '2026-09-03',
        hasData: true,
        impressions: '50',
      });
      expect(result.observedDays).toBe(2);
    });
  });

  describe('freshness', () => {
    it('returns null runs and metrics for an asset with zero runs/facts', async () => {
      const result = await service.freshness({ ...scope, assetId });

      expect(result.runs.latestSuccessfulScheduledRun).toBeNull();
      expect(result.runs.latestSuccessfulManualRun).toBeNull();
      expect(result.metrics.latestMetricDate).toBeNull();
      expect(result.hasPartialData).toBe(false);
    });

    it('splits latest successful run by run_kind', async () => {
      await insertRun({
        runKind: 'manual',
        status: 'succeeded',
        finishedAt: '2026-09-01T10:00:00.000Z',
      });
      await insertRun({
        runKind: 'scheduled',
        status: 'succeeded',
        finishedAt: '2026-09-02T10:00:00.000Z',
      });
      await insertRun({ runKind: 'manual', status: 'failed' });

      const result = await service.freshness({ ...scope, assetId });

      expect(result.runs.latestSuccessfulManualRun).toBe(
        '2026-09-01T10:00:00.000Z',
      );
      expect(result.runs.latestSuccessfulScheduledRun).toBe(
        '2026-09-02T10:00:00.000Z',
      );
    });

    it('reports latestPartialMetricDate and hasPartialData from a partial fact', async () => {
      await insertFact({ metricDate: '2026-09-01', isPartial: false });
      await insertFact({ metricDate: '2026-09-02', isPartial: true });

      const result = await service.freshness({ ...scope, assetId });

      expect(result.metrics.latestMetricDate).toBe('2026-09-02');
      expect(result.metrics.latestClosedMetricDate).toBe('2026-09-01');
      expect(result.metrics.latestPartialMetricDate).toBe('2026-09-02');
      expect(result.hasPartialData).toBe(true);
    });
  });

  describe('listAssets', () => {
    it('includes revoked assets and never selects assetTokenEncrypted', async () => {
      const revokedId = randomUUID();
      await queryRunner.query(`
        INSERT INTO "social_organic_assets"
          ("id", "tenant_id", "workspace_id", "connection_id", "provider",
           "asset_type", "external_asset_id", "status", "asset_token_encrypted")
        VALUES (
          '${revokedId}', '${tenantId}', '${workspaceId}', '${connectionId}',
          'meta', 'facebook_page', 'external-revoked', 'revoked', 'secret-token'
        )
      `);

      const items = await service.listAssets(scope);

      expect(items.map((item) => item.id)).toEqual(
        expect.arrayContaining([assetId, revokedId]),
      );
      for (const item of items) {
        expect(item).not.toHaveProperty('assetTokenEncrypted');
      }
    });
  });

  describe('publicationMetrics', () => {
    it('takes only the latest observation and keeps snapshots separate from daily values', async () => {
      const publicationId = randomUUID();
      await insertPostFact({
        publicationId,
        metricDate: '2026-09-01',
        reach: '80',
        shares: '2',
        likesLifetime: '10',
        videoViewsLifetime: '100',
        syncedAt: '2026-09-01T12:00:00.000Z',
      });
      await insertPostFact({
        publicationId,
        metricDate: '2026-09-02',
        reach: '90',
        shares: '3',
        likesLifetime: '12',
        videoViewsLifetime: '130',
        isPartial: true,
        syncedAt: '2026-09-02T12:00:00.000Z',
      });

      const items = await service.publicationMetrics({
        ...scope,
        publicationIds: [publicationId],
      });

      expect(items).toEqual([
        expect.objectContaining({
          publicationId,
          metricDate: '2026-09-02',
          views: '130',
          viewsGranularity: 'lifetime',
          likes: '12',
          likesGranularity: 'lifetime',
          reach: '90',
          reachGranularity: 'daily',
          shares: '3',
          sharesGranularity: 'daily',
          isPartial: true,
        }),
      ]);
    });

    it('does not return another managed client publication', async () => {
      const publicationId = randomUUID();
      await insertPostFact({
        publicationId,
        assetId: clientAssetId,
        agencyClientId,
        metricDate: '2026-09-01',
      });

      await expect(
        service.publicationMetrics({ ...scope, publicationIds: [publicationId] }),
      ).resolves.toEqual([]);
    });
  });

  describe('decimal-string precision', () => {
    it('preserves a bigint beyond Number.MAX_SAFE_INTEGER as a string', async () => {
      await insertFact({
        metricDate: '2026-09-01',
        impressions: '9007199254740993',
      });

      const result = await overview('2026-09-01', '2026-09-01');
      expect(result.totals.impressions).toBe('9007199254740993');
      expect(typeof result.totals.impressions).toBe('string');
    });
  });
});
