import { ClientAreaSocialMetricsAdapter } from './client-area-social-metrics.adapter';
import { ClientAreaSourcesRegistry } from './client-area-sources.registry';
import { metricById } from './client-area-layout.contract';
const scope = {
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: 'client',
  companyContextId: 'company',
};
describe('CA13 Social canonical-source adapter', () => {
  const paid = {
    listConnections: jest.fn(),
    overview: jest.fn(),
    timeseries: jest.fn(),
    campaigns: jest.fn(),
  };
  const organic = {
    listAssets: jest.fn(),
    overview: jest.fn(),
    timeseries: jest.fn(),
    topPosts: jest.fn(),
  };
  const audience = { audience: jest.fn() };
  let adapter: ClientAreaSocialMetricsAdapter;
  beforeEach(() => {
    jest.resetAllMocks();
    paid.listConnections.mockResolvedValue([{ id: 'paid' }]);
    organic.listAssets.mockResolvedValue([
      { id: 'fb', provider: 'facebook' },
      { id: 'ig', provider: 'instagram' },
    ]);
    paid.overview.mockResolvedValue({
      currency: 'BRL',
      current: {
        spend: '9007199254740993.01',
        periodReach: null,
        internal: 'secret',
      },
      lastSyncError: 'provider token secret',
      config: { accessToken: 'secret' },
      period: { since: '2026-10-01', until: '2026-10-02' },
    });
    organic.overview.mockResolvedValue({
      totals: { followersCount: '99', periodReach: null },
    });
    organic.topPosts.mockResolvedValue({ items: [] });
    audience.audience.mockResolvedValue({
      buckets: [{ key: 'city', value: '3' }],
    });
    adapter = new ClientAreaSocialMetricsAdapter(
      new ClientAreaSourcesRegistry(),
      paid as never,
      organic as never,
      {} as never,
      audience as never,
      {} as never,
      {} as never,
    );
  });
  const input = (id: string, query = {}) => ({
    scope,
    userId: 'user',
    query: { from: '2026-10-01', to: '2026-10-02', ...query },
    metric: metricById(id),
  });
  it('keeps exact canonical paid values and nulls without reading another source', async () => {
    const result = await adapter.read(input('social.spend'));
    expect(result).toMatchObject({
      sources: {
        paid: {
          currency: 'BRL',
          current: { spend: '9007199254740993.01', periodReach: null },
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(organic.listAssets).not.toHaveBeenCalled();
    expect(paid.overview).toHaveBeenCalledWith({
      ...scope,
      connectionId: 'paid',
      since: '2026-10-01',
      until: '2026-10-02',
    });
  });
  it('proves scoped connection ids; ambiguous selection never falls back to another account', async () => {
    paid.listConnections.mockResolvedValue([{ id: 'one' }, { id: 'two' }]);
    await expect(adapter.read(input('social.spend'))).rejects.toMatchObject({
      reason: 'source_selection_required',
    });
    await expect(
      adapter.read(input('social.spend', { connectionId: 'foreign' })),
    ).rejects.toMatchObject({ status: 404 });
    expect(paid.overview).not.toHaveBeenCalled();
  });
  it('reads the Page city snapshot when Facebook is selected, with no arithmetic', async () => {
    await adapter.read(
      input('social.followers_city', { socialChannel: 'facebook' }),
    );
    expect(audience.audience).toHaveBeenCalledWith(
      expect.objectContaining({ ...scope, assetId: 'fb', kind: 'city' }),
    );
    expect(organic.overview).not.toHaveBeenCalled();
    expect(paid.listConnections).not.toHaveBeenCalled();
  });
  it('does not silently read Instagram for a Facebook-only metric', async () => {
    const result = await adapter.read(input('social.page_views'));
    expect(result).toMatchObject({ mode: 'canonical_sources' });
    expect(organic.overview).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'fb' }),
    );
    await expect(
      adapter.read(input('social.page_views', { socialChannel: 'instagram' })),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('uses the source table surface and rejects foreign organic asset ids', async () => {
    await adapter.read(input('social.table.organic_posts'));
    expect(organic.topPosts).toHaveBeenCalledWith({
      ...scope,
      assetId: 'ig',
      since: '2026-10-01',
      until: '2026-10-02',
      surface: 'feed',
    });
    await expect(
      adapter.read(
        input('social.table.organic_posts', {
          instagramAssetId: 'other-company',
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('reads canonical daily series for chart cards without aggregating or substituting overview values', async () => {
    paid.timeseries.mockResolvedValue({
      points: [
        {
          date: '2026-10-01',
          spend: '9007199254740993.01',
          reach: null,
          hasData: true,
        },
      ],
    });
    const result = await adapter.read(
      input('social.spend', { view: 'series' }),
    );
    expect(result).toMatchObject({
      mode: 'canonical_sources',
      sources: {
        paidSeries: {
          points: [
            {
              date: '2026-10-01',
              spend: '9007199254740993.01',
              reach: null,
              hasData: true,
            },
          ],
        },
        organicSeries: null,
      },
    });
    expect(paid.timeseries).toHaveBeenCalledWith({
      ...scope,
      connectionId: 'paid',
      since: '2026-10-01',
      until: '2026-10-02',
    });
    expect(paid.overview).not.toHaveBeenCalled();
    expect(organic.listAssets).not.toHaveBeenCalled();
  });
  it('uses the Facebook daily series for a Facebook stock without reading paid or Instagram', async () => {
    organic.timeseries.mockResolvedValue({
      points: [{ date: '2026-10-01', pageViews: null, hasData: false }],
    });
    const result = await adapter.read(
      input('social.page_views', { view: 'series' }),
    );
    expect(result).toMatchObject({
      sources: {
        paidSeries: null,
        organicSeries: { points: [{ pageViews: null, hasData: false }] },
      },
    });
    expect(organic.timeseries).toHaveBeenCalledWith({
      ...scope,
      assetId: 'fb',
      since: '2026-10-01',
      until: '2026-10-02',
    });
    expect(organic.overview).not.toHaveBeenCalled();
    expect(paid.listConnections).not.toHaveBeenCalled();
  });
});
