import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  SocialOrganicDiscoveredAsset,
  SocialOrganicPreparedAsset,
} from '../../connections';
import {
  MetaOrganicGraphService,
  type MetaOrganicFacebookPage,
} from './meta-organic-graph.service';

const FACEBOOK_PUBLISH_TASKS = new Set(['CREATE_CONTENT', 'MANAGE']);

@Injectable()
export class MetaOrganicAssetDiscoveryService {
  constructor(private readonly graph: MetaOrganicGraphService) {}

  async discover(
    userAccessToken: string,
  ): Promise<SocialOrganicDiscoveredAsset[]> {
    const pages = await this.graph.listFacebookPages(userAccessToken);
    const assets: SocialOrganicDiscoveredAsset[] = [];
    const seen = new Set<string>();

    for (const page of pages) {
      // A Page token without a content task may be readable but cannot back a
      // publish-enabled asset. Do not offer it (or its linked IG identity) for
      // selection, because F6 enables every explicitly selected asset.
      if (!this.isPublishablePage(page)) continue;

      this.pushUnique(assets, seen, {
        externalAssetId: page.pageId,
        assetType: 'facebook_page',
        displayName: page.pageName,
        username: null,
        avatarUrl: page.avatarUrl,
        capabilities: {},
        selectionData: { pageId: page.pageId },
      });

      const instagram = await this.graph.getFacebookPageInstagramAccount({
        pageId: page.pageId,
        pageAccessToken: page.pageAccessToken,
      });

      if (instagram) {
        this.pushUnique(assets, seen, {
          externalAssetId: instagram.accountId,
          assetType: 'instagram_professional',
          displayName: instagram.name,
          username: instagram.username,
          avatarUrl: instagram.avatarUrl,
          capabilities: {},
          // Non-secret linkage only. The Page token is fetched again during
          // selection and goes straight into F6's encrypted asset column.
          selectionData: { pageId: page.pageId },
        });
      }
    }

    return assets;
  }

  async prepare(input: {
    userAccessToken: string;
    asset: SocialOrganicDiscoveredAsset;
  }): Promise<SocialOrganicPreparedAsset> {
    const pageId = this.readPageId(input.asset.selectionData);
    const pages = await this.graph.listFacebookPages(input.userAccessToken);
    const page = pages.find((candidate) => candidate.pageId === pageId);

    if (!page || !this.isPublishablePage(page)) {
      throw new BadRequestException('meta_asset_not_available');
    }

    if (input.asset.assetType === 'facebook_page') {
      if (input.asset.externalAssetId !== page.pageId) {
        throw new BadRequestException('meta_asset_not_available');
      }

      return {
        accessToken: page.pageAccessToken,
        tokenExpiresAt: null,
        metadata: { pageId: page.pageId },
      };
    }

    if (input.asset.assetType === 'instagram_professional') {
      const instagram = await this.graph.getFacebookPageInstagramAccount({
        pageId: page.pageId,
        pageAccessToken: page.pageAccessToken,
      });

      if (!instagram || instagram.accountId !== input.asset.externalAssetId) {
        throw new BadRequestException('meta_asset_not_available');
      }

      return {
        accessToken: page.pageAccessToken,
        tokenExpiresAt: null,
        metadata: { pageId: page.pageId },
      };
    }

    throw new BadRequestException('meta_asset_not_available');
  }

  private isPublishablePage(page: MetaOrganicFacebookPage): boolean {
    return page.tasks.some((task) => FACEBOOK_PUBLISH_TASKS.has(task));
  }

  private readPageId(
    selectionData: Record<string, unknown> | undefined,
  ): string {
    const value = selectionData?.pageId;
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException('meta_asset_not_available');
    }
    return value.trim();
  }

  private pushUnique(
    assets: SocialOrganicDiscoveredAsset[],
    seen: Set<string>,
    asset: SocialOrganicDiscoveredAsset,
  ): void {
    if (seen.has(asset.externalAssetId)) return;
    seen.add(asset.externalAssetId);
    assets.push(asset);
  }
}
