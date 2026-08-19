import { MetaAssetDiscoveryService } from './meta-asset-discovery.service';
import { MetaGraphService } from './meta-graph.service';

describe('MetaAssetDiscoveryService', () => {
  it('normalizes multiple Pages and preserves a Page without Instagram', async () => {
    const metaGraphService = {
      listFacebookPages: jest.fn().mockResolvedValue([
        {
          pageId: 'page-1',
          pageName: 'Page One',
          pageAccessToken: 'page-secret-1',
          tasks: ['MESSAGING'],
        },
        {
          pageId: 'page-2',
          pageName: 'Page Two',
          pageAccessToken: 'page-secret-2',
          tasks: [],
        },
      ]),
      getFacebookPageInstagramAccount: jest
        .fn()
        .mockResolvedValueOnce({
          accountId: 'instagram-1',
          username: 'page.one',
        })
        .mockResolvedValueOnce(null),
    } as unknown as MetaGraphService;
    const service = new MetaAssetDiscoveryService(metaGraphService);

    await expect(
      service.discoverFacebookPageAssets('user-secret'),
    ).resolves.toEqual([
      {
        pageId: 'page-1',
        pageName: 'Page One',
        pageAccessToken: 'page-secret-1',
        tasks: ['MESSAGING'],
        instagramAccount: {
          accountId: 'instagram-1',
          username: 'page.one',
        },
      },
      {
        pageId: 'page-2',
        pageName: 'Page Two',
        pageAccessToken: 'page-secret-2',
        tasks: [],
        instagramAccount: null,
      },
    ]);
  });
});
