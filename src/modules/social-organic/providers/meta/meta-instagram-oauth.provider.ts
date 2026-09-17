import { Injectable } from '@nestjs/common';
import type {
  SocialOrganicDiscoveredAsset,
  SocialOrganicOAuthProviderConfiguration,
  SocialOrganicOAuthProviderHooks,
} from '../../connections';
import { MetaInstagramAssetDiscoveryService } from './meta-instagram-asset-discovery.service';
import { MetaOrganicGraphService } from './meta-organic-graph.service';
import {
  META_INSTAGRAM_PROVIDER,
  SOCIAL_META_INSTAGRAM_SCOPES,
  buildMetaInstagramAuthorizationUrl,
  buildSocialOrganicFrontendRedirectUrl,
  requireSocialMetaInstagramCallbackUrl,
  type MetaInstagramLoginConfig,
} from './meta-organic-oauth.support';

function expiresAt(expiresIn: number | null): Date | null {
  if (expiresIn === null || expiresIn <= 0) return null;
  return new Date(Date.now() + expiresIn * 1000);
}

/** Direct Instagram Login is a separate Organic OAuth provider. */
@Injectable()
export class MetaInstagramOAuthProvider implements SocialOrganicOAuthProviderHooks {
  readonly configuration: SocialOrganicOAuthProviderConfiguration;

  constructor(
    private readonly graph: MetaOrganicGraphService,
    private readonly discovery: MetaInstagramAssetDiscoveryService,
  ) {
    const graphService = this.graph;
    this.configuration = {
      provider: META_INSTAGRAM_PROVIDER,
      authorizationMethod: 'oauth_user',
      scopes: SOCIAL_META_INSTAGRAM_SCOPES,
      get loginConfig() {
        return graphService.getInstagramLoginConfig();
      },
      get callbackUrl() {
        return requireSocialMetaInstagramCallbackUrl();
      },
      get frontendRedirectUrl() {
        return buildSocialOrganicFrontendRedirectUrl();
      },
    };
  }

  buildAuthorizationUrl(input: {
    loginConfig: unknown;
    callbackUrl: URL;
    state: string;
  }): URL {
    return buildMetaInstagramAuthorizationUrl({
      loginConfig: input.loginConfig as MetaInstagramLoginConfig,
      callbackUrl: input.callbackUrl,
      state: input.state,
    });
  }

  async exchangeCode(input: {
    loginConfig: unknown;
    callbackUrl: URL;
    code: string;
  }) {
    const shortLived = await this.graph.exchangeInstagramOAuthCode({
      code: input.code,
      redirectUri: input.callbackUrl.toString(),
    });

    let grant = shortLived;
    try {
      grant = await this.graph.exchangeInstagramLongLivedToken(
        shortLived.accessToken,
      );
    } catch {
      // A valid short-lived grant remains usable until its honest expiry.
    }

    return {
      accessToken: grant.accessToken,
      refreshToken: null,
      tokenExpiresAt: expiresAt(grant.expiresIn),
      scopes: SOCIAL_META_INSTAGRAM_SCOPES,
    };
  }

  discoverAssets(input: { accessToken: string }) {
    return this.discovery.discover(input.accessToken);
  }

  prepareAsset(input: {
    accessToken: string;
    asset: SocialOrganicDiscoveredAsset;
  }) {
    return this.discovery.prepare(input);
  }

}
