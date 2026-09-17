import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  SocialOrganicDiscoveredAsset,
  SocialOrganicPreparedAsset,
} from '../../connections';
import { MetaOrganicGraphService } from './meta-organic-graph.service';

const INSTAGRAM_PROFESSIONAL = 'instagram_professional';

/** Asset discovery for Instagram Login; it never traverses Facebook Pages. */
@Injectable()
export class MetaInstagramAssetDiscoveryService {
  constructor(private readonly graph: MetaOrganicGraphService) {}

  async discover(
    accessToken: string,
  ): Promise<readonly SocialOrganicDiscoveredAsset[]> {
    const account = await this.graph.getDirectInstagramAccount(accessToken);
    return [
      {
        externalAssetId: account.accountId,
        assetType: INSTAGRAM_PROFESSIONAL,
        displayName: account.name,
        username: account.username,
        avatarUrl: account.avatarUrl,
        capabilities: {},
        selectionData: { accountId: account.accountId },
      },
    ];
  }

  async prepare(input: {
    accessToken: string;
    asset: SocialOrganicDiscoveredAsset;
  }): Promise<SocialOrganicPreparedAsset> {
    if (input.asset.assetType !== INSTAGRAM_PROFESSIONAL) {
      throw new BadRequestException('meta_asset_not_available');
    }
    const account = await this.graph.getDirectInstagramAccount(input.accessToken);
    if (account.accountId !== input.asset.externalAssetId) {
      throw new BadRequestException('meta_asset_not_available');
    }

    // OAuth-user credentials are retained only on the connection and resolved
    // by the central credential boundary; an asset token must not be copied.
    return {
      accessToken: null,
      tokenExpiresAt: null,
      assetTimezone: null,
      metadata: { accountId: account.accountId, authorization: 'instagram_login' },
    };
  }
}
