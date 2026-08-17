import { Injectable } from '@nestjs/common';
import { FacebookPageAsset } from '../types/meta-assets.types';
import { MetaGraphService } from './meta-graph.service';

@Injectable()
export class MetaAssetDiscoveryService {
  constructor(private readonly metaGraphService: MetaGraphService) {}

  async discoverFacebookPageAssets(
    userAccessToken: string,
  ): Promise<FacebookPageAsset[]> {
    const pages =
      await this.metaGraphService.listFacebookPages(userAccessToken);
    const assets: FacebookPageAsset[] = [];

    for (const page of pages) {
      assets.push({
        ...page,
        instagramAccount:
          await this.metaGraphService.getFacebookPageInstagramAccount({
            pageId: page.pageId,
            pageAccessToken: page.pageAccessToken,
          }),
      });
    }

    return assets;
  }
}
