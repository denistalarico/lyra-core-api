import { Injectable } from '@nestjs/common';
import {
  SocialOrganicOAuthRefreshError,
  type SocialOrganicDiscoveredAsset,
  type SocialOrganicOAuthProviderConfiguration,
  type SocialOrganicOAuthProviderHooks,
  type SocialOrganicOAuthTokenGrant,
  type SocialOrganicRevocationInput,
} from '../../connections/social-organic-oauth.provider';
import { buildSocialOrganicFrontendRedirectUrl } from '../meta/meta-organic-oauth.support';
import {
  TiktokBusinessApiClient,
  TiktokBusinessApiError,
  type TiktokBusinessTokenGrant,
} from './tiktok-business-api.client';
import {
  SOCIAL_TIKTOK_BUSINESS_SCOPES,
  TIKTOK_BUSINESS_ACCOUNT_ASSET_TYPE,
  TIKTOK_BUSINESS_ACCOUNT_CAPABILITIES,
  TIKTOK_BUSINESS_PROVIDER,
} from './tiktok-business-capabilities';
import {
  buildTiktokAccountAuthorizationUrl,
  requireTiktokAccountCallbackUrl,
  requireTiktokBusinessAppConfig,
  type TiktokBusinessAppConfig,
} from './tiktok-business-oauth.support';

/** DOCUMENTED (Return Codes): refresh token expired / invalid. */
const LOST_GRANT_CODES = new Set([40103, 40107]);

function toGrant(
  grant: TiktokBusinessTokenGrant,
): SocialOrganicOAuthTokenGrant {
  return {
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    // The access token lives one day; the refresh token, one year.
    tokenExpiresAt:
      grant.expiresIn && grant.expiresIn > 0
        ? new Date(Date.now() + grant.expiresIn * 1000)
        : null,
    scopes: grant.scopes.length ? grant.scopes : SOCIAL_TIKTOK_BUSINESS_SCOPES,
  };
}

/**
 * TikTok account holder authorization (API for Business, "TikTok Accounts").
 * The authorizing account is the asset (one `tiktok_business_account`, keyed
 * by the app-specific `business_id`), so selection is a single confirmation.
 */
@Injectable()
export class TiktokBusinessOAuthProvider implements SocialOrganicOAuthProviderHooks {
  readonly configuration: SocialOrganicOAuthProviderConfiguration;

  constructor(private readonly api: TiktokBusinessApiClient) {
    // Accessors: the API boots while this optional integration is unconfigured.
    this.configuration = {
      provider: TIKTOK_BUSINESS_PROVIDER,
      authorizationMethod: 'oauth_user',
      scopes: SOCIAL_TIKTOK_BUSINESS_SCOPES,
      get loginConfig() {
        return requireTiktokBusinessAppConfig();
      },
      get callbackUrl() {
        return requireTiktokAccountCallbackUrl();
      },
      get frontendRedirectUrl() {
        return buildSocialOrganicFrontendRedirectUrl();
      },
    };
  }

  buildAuthorizationUrl(input: { state: string }): URL {
    return buildTiktokAccountAuthorizationUrl(input.state);
  }

  async exchangeCode(input: {
    loginConfig: unknown;
    callbackUrl: URL;
    code: string;
  }): Promise<SocialOrganicOAuthTokenGrant> {
    return toGrant(
      await this.api.exchangeCode({
        app: input.loginConfig as TiktokBusinessAppConfig,
        code: input.code,
        // Must equal the redirect URL registered on the app, slash included.
        redirectUri: input.callbackUrl.toString(),
      }),
    );
  }

  async discoverAssets(input: {
    accessToken: string;
  }): Promise<readonly SocialOrganicDiscoveredAsset[]> {
    const app = requireTiktokBusinessAppConfig();
    const { businessId } = await this.api.tokenInfo({
      app,
      accessToken: input.accessToken,
    });
    const profile = await this.api.profile({
      accessToken: input.accessToken,
      businessId,
    });
    return [
      {
        externalAssetId: businessId,
        assetType: TIKTOK_BUSINESS_ACCOUNT_ASSET_TYPE,
        displayName: profile.displayName ?? profile.username,
        username: profile.username,
        avatarUrl: profile.profileImage,
        capabilities: { ...TIKTOK_BUSINESS_ACCOUNT_CAPABILITIES },
      },
    ];
  }

  prepareAsset(): Promise<{ metadata: Record<string, unknown> }> {
    // No asset token: the account holder token is the only credential.
    return Promise.resolve({ metadata: {} });
  }

  async revokeAuthorization(input: SocialOrganicRevocationInput) {
    if (!input.connectionAccessToken) return;
    await this.api.revoke({
      app: requireTiktokBusinessAppConfig(),
      accessToken: input.connectionAccessToken,
    });
  }

  async refreshAccessToken(input: {
    loginConfig: unknown;
    refreshToken: string;
  }): Promise<SocialOrganicOAuthTokenGrant> {
    try {
      return toGrant(
        await this.api.refresh({
          app: input.loginConfig as TiktokBusinessAppConfig,
          refreshToken: input.refreshToken,
        }),
      );
    } catch (error) {
      if (
        error instanceof TiktokBusinessApiError &&
        error.code !== null &&
        LOST_GRANT_CODES.has(error.code)
      ) {
        throw new SocialOrganicOAuthRefreshError('permanent');
      }
      throw new SocialOrganicOAuthRefreshError('transient');
    }
  }
}
