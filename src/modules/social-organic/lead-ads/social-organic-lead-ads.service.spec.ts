import { MetaOrganicGraphError } from '../providers/meta/meta-organic-graph.error';
import {
  OrganicLeadAdsError,
  SocialOrganicLeadAdsService,
} from './social-organic-lead-ads.service';

const PAGE = {
  assetId: 'asset-1',
  pageId: '777',
  name: 'Página Fictícia',
  permission: 'ready' as const,
  tenantId: 'tenant-1',
  workspaceId: 'ws-1',
  agencyClientId: null,
  companyContextId: null,
};

function setup(
  assetScopes: string[] = ['leads_retrieval', 'pages_manage_metadata'],
) {
  const assets = {
    find: jest.fn().mockResolvedValue([
      {
        id: 'asset-1',
        externalAssetId: '777',
        displayName: 'Página Fictícia',
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        agencyClientId: null,
        companyContextId: null,
        connection: { scopes: assetScopes },
      },
    ]),
  };
  const credentials = {
    resolvePersistedForLeads: jest
      .fn()
      .mockResolvedValue({ accessToken: 'test-page-token' }),
  };
  const graph = {
    getPageSubscribedFields: jest.fn().mockResolvedValue(['feed']),
    subscribePageFields: jest.fn().mockResolvedValue(undefined),
    getLead: jest.fn().mockResolvedValue({ id: '9001' }),
  };
  const service = new SocialOrganicLeadAdsService(
    assets as never,
    credentials as never,
    graph as never,
  );
  return { service, assets, credentials, graph };
}

describe('SocialOrganicLeadAdsService (ML1)', () => {
  it('lists active Meta Pages with the Lead Ads permission hint', async () => {
    const { service } = setup(['read_insights']);
    const [page] = await service.listPages({
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
    });
    expect([page.pageId, page.permission]).toEqual([
      '777',
      'reconnect_required',
    ]);
  });

  it('filters by the exact client scope when asked', async () => {
    const { service, assets } = setup();
    await service.listPages({
      tenantId: 'tenant-1',
      workspaceId: 'ws-1',
      exact: { agencyClientId: 'client-1', companyContextId: 'ctx-1' },
    });
    expect(
      (assets.find.mock.calls[0] as [{ where: Record<string, unknown> }])[0]
        .where,
    ).toMatchObject({
      provider: 'meta',
      assetType: 'facebook_page',
      status: 'active',
      agencyClientId: 'client-1',
      companyContextId: 'ctx-1',
    });
  });

  it('adds leadgen to the fields the Page already had', async () => {
    const { service, graph } = setup();
    await expect(service.subscribe(PAGE)).resolves.toBe('subscribed');
    expect(
      (graph.subscribePageFields.mock.calls[0] as [{ fields: string[] }])[0]
        .fields,
    ).toEqual(['feed', 'leadgen']);
  });

  it('does not post again when leadgen is already subscribed', async () => {
    const { service, graph } = setup();
    graph.getPageSubscribedFields.mockResolvedValue(['leadgen']);
    await service.subscribe(PAGE);
    expect(graph.subscribePageFields).not.toHaveBeenCalled();
  });

  it('reports missing_permission when Meta refuses the subscription', async () => {
    const { service, graph } = setup();
    graph.getPageSubscribedFields.mockRejectedValue(
      new MetaOrganicGraphError({
        kind: 'permission_denied',
        code: 'meta_permission_denied',
      }),
    );
    await expect(service.subscribe(PAGE)).resolves.toBe('missing_permission');
  });

  it('reads a lead with the Page token resolved for leads', async () => {
    const { service, credentials, graph } = setup();
    await service.readLead(PAGE, '9001');
    expect([
      (credentials.resolvePersistedForLeads.mock.calls[0] as [unknown])[0],
      graph.getLead.mock.calls[0],
    ]).toEqual([
      {
        assetId: 'asset-1',
        tenantId: 'tenant-1',
        workspaceId: 'ws-1',
        agencyClientId: null,
      },
      [{ leadId: '9001', accessToken: 'test-page-token' }],
    ]);
  });

  it('classifies a rate limit as transient, without the token in the error', async () => {
    const { service, graph } = setup();
    graph.getLead.mockRejectedValue(
      new MetaOrganicGraphError({
        kind: 'rate_limited',
        code: 'meta_rate_limited',
      }),
    );
    const error = (await service
      .readLead(PAGE, '9001')
      .catch((caught: unknown) => caught)) as OrganicLeadAdsError;
    expect([
      error.kind,
      error.code,
      JSON.stringify(error).includes('test-page-token'),
    ]).toEqual(['transient', 'meta_rate_limited', false]);
  });
});
