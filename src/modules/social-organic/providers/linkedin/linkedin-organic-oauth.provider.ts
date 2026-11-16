import { Injectable } from '@nestjs/common';
import {
  SocialOrganicOAuthRefreshError,
  type SocialOrganicDiscoveredAsset,
  type SocialOrganicOAuthProviderConfiguration,
  type SocialOrganicOAuthProviderHooks,
  type SocialOrganicOAuthTokenGrant,
  type SocialOrganicPreparedAsset,
} from '../../connections/social-organic-oauth.provider';
import { buildSocialOrganicFrontendRedirectUrl } from '../meta/meta-organic-oauth.support';
import {
  LinkedInOrganicApiClient,
  LinkedInOrganicApiError,
  type LinkedInOrganicTokenGrant,
} from './linkedin-organic-api.client';
import {
  LINKEDIN_ORGANIZATION_ASSET_TYPE,
  LINKEDIN_ORGANIZATION_CAPABILITIES,
  LINKEDIN_PROVIDER,
  SOCIAL_LINKEDIN_ORGANIC_SCOPES,
} from './linkedin-capabilities';
import {
  buildLinkedInOrganicAuthorizationUrl,
  requireLinkedInOrganicCallbackUrl,
  requireLinkedInOrganicLoginConfig,
  type LinkedInOrganicLoginConfig,
} from './linkedin-organic-oauth.support';

/** Discovery reads at most this many pages (one GET each, no BATCH_GET). */
export const LINKEDIN_MAX_DISCOVERED_ORGANIZATIONS = 20;

function toGrant(
  grant: LinkedInOrganicTokenGrant,
): SocialOrganicOAuthTokenGrant {
  return {
    accessToken: grant.accessToken,
    // Only approved MDP partners receive one (DOCUMENTED); usually null.
    refreshToken: grant.refreshToken,
    tokenExpiresAt: grant.expiresIn
      ? new Date(Date.now() + grant.expiresIn * 1000)
      : null,
    scopes: grant.scopes.length ? grant.scopes : SOCIAL_LINKEDIN_ORGANIC_SCOPES,
  };
}

/**
 * D-I9: LinkedIn Pages as an organic `oauth_user` provider of the dedicated
 * "Lyra Social Pages" app. The access token lives 60 days; refresh happens
 * only when LinkedIn issued a refresh token, otherwise the expired connection
 * asks for a reconnect.
 */
@Injectable()
export class LinkedInOrganicOAuthProvider implements SocialOrganicOAuthProviderHooks {
  readonly configuration: SocialOrganicOAuthProviderConfiguration;

  constructor(private readonly api: LinkedInOrganicApiClient) {
    // Accessors defer env validation until LinkedIn connect is actually used.
    this.configuration = {
      provider: LINKEDIN_PROVIDER,
      authorizationMethod: 'oauth_user',
      scopes: SOCIAL_LINKEDIN_ORGANIC_SCOPES,
      get loginConfig() {
        return requireLinkedInOrganicLoginConfig();
      },
      get callbackUrl() {
        return requireLinkedInOrganicCallbackUrl();
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
    return buildLinkedInOrganicAuthorizationUrl({
      loginConfig: input.loginConfig as LinkedInOrganicLoginConfig,
      callbackUrl: input.callbackUrl,
      state: input.state,
    });
  }

  async exchangeCode(input: {
    loginConfig: unknown;
    callbackUrl: URL;
    code: string;
  }): Promise<SocialOrganicOAuthTokenGrant> {
    return toGrant(
      await this.api.exchangeCode({
        loginConfig: input.loginConfig as LinkedInOrganicLoginConfig,
        code: input.code,
        redirectUri: input.callbackUrl.toString(),
      }),
    );
  }

  /** Pages where the member is an approved ADMINISTRATOR. */
  async discoverAssets(input: {
    accessToken: string;
  }): Promise<readonly SocialOrganicDiscoveredAsset[]> {
    const ids = (
      await this.api.administeredOrganizationIds(input.accessToken)
    ).slice(0, LINKEDIN_MAX_DISCOVERED_ORGANIZATIONS);
    const assets: SocialOrganicDiscoveredAsset[] = [];
    for (const id of ids) {
      const organization = await this.api.organization(input.accessToken, id);
      assets.push({
        externalAssetId: id,
        assetType: LINKEDIN_ORGANIZATION_ASSET_TYPE,
        displayName: organization.name,
        username: organization.vanityName,
        avatarUrl: null,
        capabilities: { ...LINKEDIN_ORGANIZATION_CAPABILITIES },
      });
    }
    return assets;
  }

  /**
   * No page token: the member token is the credential. LinkedIn buckets every
   * statistic by UTC day (share/follower statistics), so the asset timezone is
   * the provider's own reporting grain, not an inference.
   */
  prepareAsset(): Promise<SocialOrganicPreparedAsset> {
    return Promise.resolve({ assetTimezone: 'UTC', metadata: {} });
  }

  /** D-I5, only when a refresh token exists; a revoked grant is permanent. */
  async refreshAccessToken(input: {
    loginConfig: unknown;
    refreshToken: string;
  }): Promise<SocialOrganicOAuthTokenGrant> {
    try {
      return toGrant(
        await this.api.refresh({
          loginConfig: input.loginConfig as LinkedInOrganicLoginConfig,
          refreshToken: input.refreshToken,
        }),
      );
    } catch (error) {
      if (
        error instanceof LinkedInOrganicApiError &&
        error.code === 'grant_revoked'
      ) {
        throw new SocialOrganicOAuthRefreshError('permanent');
      }
      throw new SocialOrganicOAuthRefreshError('transient');
    }
  }
}
