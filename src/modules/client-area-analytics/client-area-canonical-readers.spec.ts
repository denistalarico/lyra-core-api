import { SocialAnalyticsReadService } from '../social-integrations/services/social-analytics-read.service';
import { projectSocialAnalyticsData } from './client-area-social-data.projection';

describe('CA13 canonical read projections', () => {
  it('selects the latest scoped campaign and keeps canonical currency/metric values', async () => {
    const scope = {
      tenantId: 't',
      workspaceId: 'w',
      agencyClientId: 'c',
      companyContextId: 'company',
      connectionId: 'connection',
    };
    const findInScope = jest.fn().mockResolvedValue({ id: 'connection' });
    const findOne = jest.fn().mockResolvedValue({
      externalId: 'latest',
      name: 'Latest',
      providerCreatedTime: null,
      firstSeenAt: new Date('2026-10-01T00:00:00Z'),
    });
    const canonical = {
      externalId: 'latest',
      spend: '9007199254740993.01',
      reach: null,
    };
    const campaigns = jest.fn().mockResolvedValue({
      currency: 'BRL',
      period: { since: '2026-10-01', until: '2026-10-07' },
      items: [canonical],
    });
    const fixture = { findInScope, entitiesRepository: { findOne }, campaigns };
    const result: unknown =
      await SocialAnalyticsReadService.prototype.latestCampaign.call(
        fixture as never,
        scope,
      );
    expect(findInScope).toHaveBeenCalledWith(scope);
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 't',
          workspaceId: 'w',
          agencyClientId: 'c',
          connectionId: 'connection',
          entityLevel: 'campaign',
        },
        order: {
          providerCreatedTime: { direction: 'DESC', nulls: 'LAST' },
          firstSeenAt: 'DESC',
          externalId: 'DESC',
        },
      }),
    );
    expect(campaigns).toHaveBeenCalledWith(scope);
    expect(result).toMatchObject({
      externalId: 'latest',
      selectionBasis: 'first_seen_at',
      selectedAt: '2026-10-01T00:00:00.000Z',
      currency: 'BRL',
      metrics: canonical,
    });
  });
  it('drops nested developer/provider fields without changing hierarchy or null metrics', () => {
    const result = projectSocialAnalyticsData({
      freshness: { lastSyncedAt: null, lastSyncError: 'secret' },
      retentionGraph: { '0': 100, '0.5': 0, secret: 'secret' },
      items: [
        {
          externalId: 'campaign',
          destinationRaw: 'secret',
          metrics: { spend: '99.01', reach: null },
          adSets: [
            { externalId: 'adset', config: { token: 'secret' }, ads: [] },
          ],
        },
      ],
      dataQuality: { internal: 'secret' },
    });
    expect(result).toEqual({
      freshness: { lastSyncedAt: null },
      retentionGraph: { '0': 100, '0.5': 0 },
      items: [
        {
          externalId: 'campaign',
          metrics: { spend: '99.01', reach: null },
          adSets: [{ externalId: 'adset', ads: [] }],
        },
      ],
    });
  });
});
