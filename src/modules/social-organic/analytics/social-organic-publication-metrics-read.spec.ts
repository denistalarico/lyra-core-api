import type { Repository } from 'typeorm';
import { SocialOrganicAnalyticsReadService } from './social-organic-analytics-read.service';
import type { SocialOrganicPostMetricDailyEntity } from './entities/social-organic-post-metric-daily.entity';

describe('publication metrics provider identity fallback', () => {
  const scope = {
    tenantId: 'tenant',
    workspaceId: 'workspace',
    agencyClientId: 'client',
    companyContextId: 'company',
  };
  function harness(rows: object[] = []) {
    const builder: Record<string, jest.Mock> = {};
    for (const method of [
      'innerJoin',
      'distinctOn',
      'where',
      'andWhere',
      'orderBy',
      'addOrderBy',
    ])
      builder[method] = jest.fn(() => builder);
    builder.getMany = jest.fn(async () => []);
    const query = jest.fn<Promise<object[]>, [string, unknown[]]>(async () => rows);
    const repository = {
      createQueryBuilder: () => builder,
      query,
    } as unknown as Repository<SocialOrganicPostMetricDailyEntity>;
    return {
      query,
      service: new SocialOrganicAnalyticsReadService(
        {} as never,
        {} as never,
        repository,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ),
    };
  }

  it('uses all exact scope dimensions and parameterizes only the requested IDs', async () => {
    const { service, query } = harness();
    await expect(
      service.publicationMetrics({
        ...scope,
        publicationIds: ['publication', 'publication'],
      }),
    ).resolves.toEqual([]);
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      ['publication'],
      'tenant',
      'workspace',
      'client',
      'company',
    ]);
    const sql = query.mock.calls[0][0];
    for (const fragment of [
      'publication.id = ANY($1::uuid[])',
      'publication.tenant_id = $2',
      'publication.workspace_id = $3',
      'publication.agency_client_id IS NOT DISTINCT FROM $4::uuid',
      'asset.company_context_id IS NOT DISTINCT FROM $5::uuid',
      'fact.external_publication_id = publication.external_publication_id',
      'story.asset_id = publication.asset_id',
      'reel.asset_id = publication.asset_id',
    ])
      expect(sql).toContain(fragment);
  });

  it('serializes captured Story timestamps while keeping unavailable likes null', async () => {
    const at = new Date('2026-11-12T12:00:00Z');
    const { service } = harness([
      {
        publicationId: 'story',
        views: '50',
        reach: '40',
        likes: null,
        shares: '0',
        syncedAt: at,
        viewsObservedAt: at,
        likesObservedAt: null,
      },
    ]);
    await expect(
      service.publicationMetrics({ ...scope, publicationIds: ['story'] }),
    ).resolves.toMatchObject([
      {
        publicationId: 'story',
        views: '50',
        reach: '40',
        likes: null,
        shares: '0',
        syncedAt: at.toISOString(),
        viewsObservedAt: at.toISOString(),
        likesObservedAt: null,
      },
    ]);
  });

  it('retains Facebook plays and unique viewers as distinct measurements', async () => {
    const { service } = harness([
      {
        publicationId: 'reel',
        views: null,
        reach: null,
        plays: '150',
        uniqueViewers: '90',
        likes: '3',
        shares: '2',
        syncedAt: '2026-11-12T12:00:00Z',
        viewsObservedAt: null,
        likesObservedAt: null,
      },
    ]);
    await expect(
      service.publicationMetrics({ ...scope, publicationIds: ['reel'] }),
    ).resolves.toMatchObject([
      { views: null, reach: null, plays: '150', uniqueViewers: '90' },
    ]);
  });

  it('does not query facts for an empty selection', async () => {
    const { service, query } = harness();
    await expect(
      service.publicationMetrics({ ...scope, publicationIds: [] }),
    ).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
