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
  TiktokApiClient,
  TiktokApiError,
  type TiktokTokenGrant,
} from './tiktok-api.client';
import {
  SOCIAL_TIKTOK_ORGANIC_SCOPES,
  TIKTOK_ACCOUNT_ASSET_TYPE,
  TIKTOK_ACCOUNT_CAPABILITIES,
  TIKTOK_PROVIDER,
} from './tiktok-capabilities';
import {
  buildTiktokAuthorizationUrl,
  requireTiktokLoginConfig,
  requireTiktokOrganicCallbackUrl,
  type TiktokLoginConfig,
} from './tiktok-oauth.support';

function toGrant(grant: TiktokTokenGrant): SocialOrganicOAuthTokenGrant {
  return {
    accessToken: grant.accessToken,
    // Refresh tokens rotate (DOCUMENTED): the new one replaces the stored one.
    refreshToken: grant.refreshToken,
    tokenExpiresAt:
      grant.expiresIn && grant.expiresIn > 0
        ? new Date(Date.now() + grant.expiresIn * 1000)
        : null,
    scopes: grant.scopes.length ? grant.scopes : SOCIAL_TIKTOK_ORGANIC_SCOPES,
  };
}

/**
 * D-I9: TikTok Login Kit as an organic `oauth_user` provider. The account is
 * the authorizing creator itself (one asset, `tiktok_account`, keyed by
 * `open_id`), so selection is a single-item confirmation.
 */
@Injectable()
export class TiktokOrganicOAuthProvider implements SocialOrganicOAuthProviderHooks {
  readonly configuration: SocialOrganicOAuthProviderConfiguration;

  constructor(private readonly api: TiktokApiClient) {
    // Accessors defer env validation until TikTok connect is actually used,
    // so the API boots with this optional integration unconfigured.
    this.configuration = {
      provider: TIKTOK_PROVIDER,
      authorizationMethod: 'oauth_user',
      scopes: SOCIAL_TIKTOK_ORGANIC_SCOPES,
      get loginConfig() {
        return requireTiktokLoginConfig();
      },
      get callbackUrl() {
        return requireTiktokOrganicCallbackUrl();
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
    return buildTiktokAuthorizationUrl({
      loginConfig: input.loginConfig as TiktokLoginConfig,
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
        loginConfig: input.loginConfig as TiktokLoginConfig,
        code: input.code,
        redirectUri: input.callbackUrl.toString(),
      }),
    );
  }

  async discoverAssets(input: {
    accessToken: string;
  }): Promise<readonly SocialOrganicDiscoveredAsset[]> {
    const user = await this.api.userInfo(input.accessToken);
    return [
      {
        externalAssetId: user.openId,
        assetType: TIKTOK_ACCOUNT_ASSET_TYPE,
        displayName: user.displayName,
        // `username` needs `user.info.profile`, which is not requested.
        username: null,
        avatarUrl: user.avatarUrl,
        capabilities: { ...TIKTOK_ACCOUNT_CAPABILITIES },
      },
    ];
  }

  prepareAsset(): Promise<{ metadata: Record<string, unknown> }> {
    // No asset token: the connection token is the only credential.
    return Promise.resolve({ metadata: {} });
  }

  async revokeAuthorization(input: SocialOrganicRevocationInput) {
    if (!input.connectionAccessToken) return;
    await this.api.revoke({
      loginConfig: requireTiktokLoginConfig(),
      token: input.connectionAccessToken,
    });
  }

  /**
   * D-I5. Only `invalid_grant` is treated as a lost grant: the refresh-token
   * page documents just `invalid_request` (malformed request), which may be our
   * own bug and must not wipe a good credential.
   */
  async refreshAccessToken(input: {
    loginConfig: unknown;
    refreshToken: string;
  }): Promise<SocialOrganicOAuthTokenGrant> {
    try {
      return toGrant(
        await this.api.refresh({
          loginConfig: input.loginConfig as TiktokLoginConfig,
          refreshToken: input.refreshToken,
        }),
      );
    } catch (error) {
      if (error instanceof TiktokApiError && error.code === 'invalid_grant') {
        throw new SocialOrganicOAuthRefreshError('permanent');
      }
      throw new SocialOrganicOAuthRefreshError('transient');
    }
  }
}
