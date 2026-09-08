/* eslint-disable @typescript-eslint/require-await -- provider doubles intentionally return resolved async values. */
import type { MetaOrganicFacebookPage } from './meta-organic-graph.service';
import { MetaOrganicGraphService } from './meta-organic-graph.service';
import { MetaOrganicAssetDiscoveryService } from './meta-organic-asset-discovery.service';

function page(
  overrides: Partial<MetaOrganicFacebookPage> = {},
): MetaOrganicFacebookPage {
  return {
    pageId: 'page-1',
    pageName: 'Page One',
    pageAccessToken: 'page-token-secret',
    tasks: ['CREATE_CONTENT'],
    avatarUrl: null,
    ...overrides,
  };
}

function harness(
  options: {
    pages?: MetaOrganicFacebookPage[];
    instagram?: {
      accountId: string;
      name: string | null;
      username: string | null;
      avatarUrl: string | null;
    } | null;
  } = {},
) {
  const graph = {
    listFacebookPages: jest.fn(async () => options.pages ?? [page()]),
    getFacebookPageInstagramAccount: jest.fn(async () =>
      options.instagram === undefined
        ? {
            accountId: 'ig-1',
            name: 'Instagram One',
            username: 'ig_one',
            avatarUrl: null,
          }
        : options.instagram,
    ),
  };
  return {
    graph,
    service: new MetaOrganicAssetDiscoveryService(
      graph as unknown as MetaOrganicGraphService,
    ),
  };
}

describe('MetaOrganicAssetDiscoveryService', () => {
  it('normalizes a Page and its linked Instagram Professional account', async () => {
    const { service } = harness();
    const assets = await service.discover('user-token');

    expect(assets).toEqual([
      expect.objectContaining({
        externalAssetId: 'page-1',
        assetType: 'facebook_page',
        displayName: 'Page One',
        selectionData: { pageId: 'page-1' },
      }),
      expect.objectContaining({
        externalAssetId: 'ig-1',
        assetType: 'instagram_professional',
        username: 'ig_one',
        selectionData: { pageId: 'page-1' },
      }),
    ]);
    expect(JSON.stringify(assets)).not.toContain('page-token-secret');
  });

  it('keeps a Page selectable when it has no linked Instagram account', async () => {
    const { service } = harness({ instagram: null });
    await expect(service.discover('user-token')).resolves.toEqual([
      expect.objectContaining({ assetType: 'facebook_page' }),
    ]);
  });

  it('drops disabled or nonpublishable Pages and linked assets', async () => {
    const { graph, service } = harness({
      pages: [page({ tasks: ['ANALYZE', 'ADVERTISE'] })],
    });

    await expect(service.discover('user-token')).resolves.toEqual([]);
    expect(graph.getFacebookPageInstagramAccount).not.toHaveBeenCalled();
  });

  it('deduplicates assets returned through multiple Pages', async () => {
    const { service } = harness({
      pages: [page(), page({ pageId: 'page-2', pageName: 'Page Two' })],
      instagram: {
        accountId: 'ig-1',
        name: null,
        username: 'same_ig',
        avatarUrl: null,
      },
    });

    const assets = await service.discover('user-token');
    expect(assets.map((asset) => asset.externalAssetId)).toEqual([
      'page-1',
      'ig-1',
      'page-2',
    ]);
  });

  it('revalidates a Page and returns its token only from prepare', async () => {
    const { service } = harness({ instagram: null });
    await expect(
      service.prepare({
        userAccessToken: 'user-token',
        asset: {
          externalAssetId: 'page-1',
          assetType: 'facebook_page',
          selectionData: { pageId: 'page-1' },
        },
      }),
    ).resolves.toEqual({
      accessToken: 'page-token-secret',
      tokenExpiresAt: null,
      assetTimezone: null,
      metadata: { pageId: 'page-1' },
    });
  });

  it('does not invent a timezone for a linked Instagram asset', async () => {
    const { service } = harness();

    await expect(
      service.prepare({
        userAccessToken: 'user-token',
        asset: {
          externalAssetId: 'ig-1',
          assetType: 'instagram_professional',
          selectionData: { pageId: 'page-1' },
        },
      }),
    ).resolves.toMatchObject({
      assetTimezone: null,
      metadata: { pageId: 'page-1' },
    });
  });

  it('refuses a selected IG account that is no longer linked', async () => {
    const { service } = harness({ instagram: null });
    await expect(
      service.prepare({
        userAccessToken: 'user-token',
        asset: {
          externalAssetId: 'ig-1',
          assetType: 'instagram_professional',
          selectionData: { pageId: 'page-1' },
        },
      }),
    ).rejects.toThrow('meta_asset_not_available');
  });
});
