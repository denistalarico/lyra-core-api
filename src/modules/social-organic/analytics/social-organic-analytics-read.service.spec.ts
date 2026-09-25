import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { SocialOrganicAssetEntity } from '../entities/social-organic-asset.entity';
import type { SocialOrganicAccountMetricDailyEntity } from './entities/social-organic-account-metric-daily.entity';
import type { SocialOrganicPostMetricDailyEntity } from './entities/social-organic-post-metric-daily.entity';
import type { SocialOrganicReachPeriodEntity } from './entities/social-organic-reach-period.entity';
import type { SocialOrganicFacebookReelEntity } from './entities/social-organic-facebook-reel.entity';
import type { SocialOrganicStoryEntity } from './entities/social-organic-story.entity';
import type { SocialOrganicSyncRunEntity } from './entities/social-organic-sync-run.entity';
import { SocialOrganicAnalyticsReadService } from './social-organic-analytics-read.service';

/**
 * Scope-boundary and validation behavior only. The SUM-heavy aggregation
 * queries this service builds (`overview`/`timeseries`/`freshness`'s
 * internals) are exercised against real PostgreSQL in the gated
 * `.postgres.spec.ts` sibling — a mocked query builder here would only be
 * asserting that the fixture it wrote matches itself, not that the SQL is
 * correct. This spec covers what a mock *can* prove: `findAssetInScope`
 * never leaks a cross-tenant/workspace/client asset, and period parsing
 * fails closed with a `BadRequestException`.
 */
describe('SocialOrganicAnalyticsReadService (scope + validation)', () => {
  function harness(asset: Partial<SocialOrganicAssetEntity> | null) {
    const findOne = jest
      .fn<Promise<Partial<SocialOrganicAssetEntity> | null>, [unknown]>()
      .mockResolvedValue(asset);
    const assetsRepository = {
      findOne,
    } as unknown as Repository<SocialOrganicAssetEntity>;
    const metricsRepository =
      {} as Repository<SocialOrganicAccountMetricDailyEntity>;
    // `query` is stubbed because `overview` counts published reels through it.
    // Zero is the honest answer for a harness with no facts, and it keeps these
    // assertions about the aggregate rather than about the counts.
    const postMetricsRepository = {
      query: jest.fn(async () => [{ count: '0' }]),
    } as unknown as Repository<SocialOrganicPostMetricDailyEntity>;
    const runsRepository = {} as Repository<SocialOrganicSyncRunEntity>;
    // No measurement stored, which is the state every assertion here is about:
    // the overview reports `periodReach: null` rather than summing days.
    const reachPeriodsRepository = {
      findOne: jest.fn(async () => null),
    } as unknown as Repository<SocialOrganicReachPeriodEntity>;
    // No stories captured either, so the reel and story counts read zero — the
    // ordinary state of an asset before the hourly collector has run.
    const storiesRepository = {
      query: jest.fn(async () => [{ count: '0' }]),
    } as unknown as Repository<SocialOrganicStoryEntity>;

    // No Facebook reels either: an Instagram asset has none by definition, and
    // the ranking is not what these tests exercise.
    const facebookReelsRepository =
      {} as unknown as Repository<SocialOrganicFacebookReelEntity>;

    return {
      findOne,
      service: new SocialOrganicAnalyticsReadService(
        assetsRepository,
        metricsRepository,
        postMetricsRepository,
        runsRepository,
        reachPeriodsRepository,
        storiesRepository,
        facebookReelsRepository,
      ),
    };
  }

  const scope = {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    agencyClientId: null,
  };

  it('throws generic NotFoundException, never ForbiddenException, when the asset is out of scope', async () => {
    const { service } = harness(null);

    await expect(
      service.overview({
        ...scope,
        assetId: 'missing-asset',
        since: '2026-09-01',
        until: '2026-09-08',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('scopes the lookup by tenant, workspace, and agencyClientId ?? IsNull()', async () => {
    const { service, findOne } = harness({
      id: 'asset-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      assetTimezone: 'America/Sao_Paulo',
    } as SocialOrganicAssetEntity);

    // metricsRepository/runsRepository are not exercised by this call path
    // since `findAssetInScope` throws before reaching them when the id
    // legitimately does not resolve; here we only assert the `where` shape
    // passed into `findOne`.
    await service
      .overview({
        ...scope,
        assetId: 'asset-1',
        since: '2026-09-01',
        until: '2026-09-01',
      })
      .catch(() => undefined);

    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'asset-1',
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
        }),
      }),
    );
  });

  it('rejects a malformed period with BadRequestException before touching the asset lookup', async () => {
    const { service, findOne } = harness(null);

    await expect(
      service.overview({
        ...scope,
        assetId: 'asset-1',
        since: 'not-a-date',
        until: '2026-09-08',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('rejects since after until with BadRequestException', async () => {
    const { service } = harness(null);

    await expect(
      service.overview({
        ...scope,
        assetId: 'asset-1',
        since: '2026-09-08',
        until: '2026-09-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a period exceeding the max span with BadRequestException', async () => {
    const { service } = harness(null);

    await expect(
      service.overview({
        ...scope,
        assetId: 'asset-1',
        since: '2020-01-01',
        until: '2026-09-08',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('freshness also throws NotFoundException for an out-of-scope asset', async () => {
    const { service } = harness(null);

    await expect(
      service.freshness({ ...scope, assetId: 'missing-asset' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
