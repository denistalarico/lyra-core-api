import { Injectable } from '@nestjs/common';
import type {
  SocialOrganicDiscoveredAsset,
  SocialOrganicOAuthProviderConfiguration,
  SocialOrganicOAuthProviderHooks,
  SocialOrganicRevocationInput,
} from '../../connections';
import { MetaOrganicAssetDiscoveryService } from './meta-organic-asset-discovery.service';
import { MetaOrganicGraphService } from './meta-organic-graph.service';
import {
  META_ORGANIC_PROVIDER,
  SOCIAL_META_ORGANIC_SCOPES,
  buildMetaOrganicAuthorizationUrl,
  buildSocialOrganicFrontendRedirectUrl,
  requireSocialMetaOrganicCallbackUrl,
  type MetaOrganicLoginConfig,
} from './meta-organic-oauth.support';

function expiresAt(expiresIn: number | null): Date | null {
  if (expiresIn === null || expiresIn <= 0) return null;
  return new Date(Date.now() + expiresIn * 1000);
}

@Injectable()
export class MetaOrganicOAuthProvider implements SocialOrganicOAuthProviderHooks {
  readonly configuration: SocialOrganicOAuthProviderConfiguration;

  constructor(
    private readonly graph: MetaOrganicGraphService,
    private readonly discovery: MetaOrganicAssetDiscoveryService,
  ) {
    // Accessors defer env validation until Meta connect is actually used. The
    // API may boot with this optional integration unconfigured, while F6 still
    // fails start before it creates an OAuth row.
    const graphService = this.graph;
    this.configuration = {
      provider: META_ORGANIC_PROVIDER,
      authorizationMethod: 'oauth_business',
      scopes: SOCIAL_META_ORGANIC_SCOPES,
      get loginConfig() {
        return graphService.getLoginConfig();
      },
      get callbackUrl() {
        return requireSocialMetaOrganicCallbackUrl();
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
    return buildMetaOrganicAuthorizationUrl({
      loginConfig: input.loginConfig as MetaOrganicLoginConfig,
      callbackUrl: input.callbackUrl,
      state: input.state,
    });
  }

  async exchangeCode(input: {
    loginConfig: unknown;
    callbackUrl: URL;
    code: string;
  }) {
    const shortLived = await this.graph.exchangeOAuthCode({
      code: input.code,
      redirectUri: input.callbackUrl.toString(),
    });

    let grant = shortLived;
    try {
      grant = await this.graph.exchangeLongLivedToken(shortLived.accessToken);
    } catch {
      // Meta may reject the optional long-lived exchange for some grant types.
      // The short-lived credential and its honest expiry remain usable.
    }

    return {
      accessToken: grant.accessToken,
      refreshToken: null,
      tokenExpiresAt: expiresAt(grant.expiresIn),
      scopes: SOCIAL_META_ORGANIC_SCOPES,
    };
  }

  discoverAssets(input: { accessToken: string }) {
    return this.discovery.discover(input.accessToken);
  }

  prepareAsset(input: {
    accessToken: string;
    asset: SocialOrganicDiscoveredAsset;
  }) {
    return this.discovery.prepare({
      userAccessToken: input.accessToken,
      asset: input.asset,
    });
  }

  async revokeAuthorization(
    input: SocialOrganicRevocationInput,
  ): Promise<void> {
    if (input.connectionAccessToken) {
      await this.graph.revokePermissions(input.connectionAccessToken);
    }
  }
}
