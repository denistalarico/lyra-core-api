import { Injectable } from '@nestjs/common';
import {
  SocialOrganicOAuthRefreshError,
  type SocialOrganicDiscoveredAsset,
  type SocialOrganicOAuthProviderConfiguration,
  type SocialOrganicOAuthProviderHooks,
  type SocialOrganicOAuthTokenGrant,
} from '../../connections/social-organic-oauth.provider';
import { buildSocialOrganicFrontendRedirectUrl } from '../meta/meta-organic-oauth.support';
import {
  ThreadsApiClient,
  ThreadsApiError,
  type ThreadsTokenGrant,
} from './threads-api.client';
import {
  SOCIAL_THREADS_SCOPES,
  THREADS_ACCOUNT_ASSET_TYPE,
  THREADS_ACCOUNT_CAPABILITIES,
  THREADS_PROVIDER,
} from './threads-capabilities';
import {
  buildThreadsAuthorizationUrl,
  requireThreadsAppConfig,
  requireThreadsCallbackUrl,
  type ThreadsAppConfig,
} from './threads-oauth.support';

const DAY_MS = 24 * 60 * 60_000;
/** DOCUMENTED: a short-lived token lives one hour. */
const SHORT_LIVED_MS = 60 * 60_000;
/**
 * The resolver refreshes only once `tokenExpiresAt` is within minutes, but
 * Threads refuses to refresh an expired token. So a long-lived grant is
 * stored as "renew by" seven days before Threads' real expiry, never earlier
 * than 25 h from now (a token under 24 h old cannot be refreshed).
 */
const RENEW_AHEAD_MS = 7 * DAY_MS;
const MIN_RENEW_AFTER_MS = 25 * 60 * 60_000;

/** Graph code 190 = the token is invalid, expired or revoked. */
const LOST_GRANT_CODE = 190;

export function threadsRenewAt(expiresIn: number | null, now = Date.now()) {
  if (expiresIn === null || expiresIn <= 0) return null;
  const expiresAt = now + expiresIn * 1000;
  return new Date(
    Math.max(
      expiresAt - RENEW_AHEAD_MS,
      now + Math.min(MIN_RENEW_AFTER_MS, expiresIn * 1000),
    ),
  );
}

/**
 * The long-lived token is its own refresh credential (`th_refresh_token`
 * takes the access token), so it is also stored as the refresh token.
 */
function toLongLivedGrant(
  grant: ThreadsTokenGrant,
): SocialOrganicOAuthTokenGrant {
  return {
    accessToken: grant.accessToken,
    refreshToken: grant.accessToken,
    tokenExpiresAt: threadsRenewAt(grant.expiresIn),
    scopes: SOCIAL_THREADS_SCOPES,
  };
}

/**
 * Threads profile authorization (Threads use case of the Meta app). The
 * authorizing profile is the asset (one `threads_account`, keyed by the
 * app-scoped Threads user id), so selection is a single confirmation.
 */
@Injectable()
export class ThreadsOAuthProvider implements SocialOrganicOAuthProviderHooks {
  readonly configuration: SocialOrganicOAuthProviderConfiguration;

  constructor(private readonly api: ThreadsApiClient) {
    // Accessors: the API boots while this optional integration is unconfigured.
    this.configuration = {
      provider: THREADS_PROVIDER,
      authorizationMethod: 'oauth_user',
      scopes: SOCIAL_THREADS_SCOPES,
      get loginConfig() {
        return requireThreadsAppConfig();
      },
      get callbackUrl() {
        return requireThreadsCallbackUrl();
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
    return buildThreadsAuthorizationUrl({
      app: input.loginConfig as ThreadsAppConfig,
      callbackUrl: input.callbackUrl,
      state: input.state,
    });
  }

  async exchangeCode(input: {
    loginConfig: unknown;
    callbackUrl: URL;
    code: string;
  }): Promise<SocialOrganicOAuthTokenGrant> {
    const app = input.loginConfig as ThreadsAppConfig;
    const shortLived = await this.api.exchangeCode({
      app,
      code: input.code,
      redirectUri: input.callbackUrl.toString(),
    });
    try {
      return toLongLivedGrant(
        await this.api.exchangeLongLived({
          app,
          accessToken: shortLived.accessToken,
        }),
      );
    } catch {
      // A valid short-lived grant stays usable until its honest expiry; it
      // cannot be refreshed, so the profile reconnects after one hour.
      return {
        accessToken: shortLived.accessToken,
        refreshToken: null,
        tokenExpiresAt: new Date(Date.now() + SHORT_LIVED_MS),
        scopes: SOCIAL_THREADS_SCOPES,
      };
    }
  }

  async discoverAssets(input: {
    accessToken: string;
  }): Promise<readonly SocialOrganicDiscoveredAsset[]> {
    const profile = await this.api.profile(input.accessToken);
    return [
      {
        externalAssetId: profile.id,
        assetType: THREADS_ACCOUNT_ASSET_TYPE,
        displayName: profile.name ?? profile.username,
        username: profile.username,
        avatarUrl: profile.profilePictureUrl,
        capabilities: { ...THREADS_ACCOUNT_CAPABILITIES },
      },
    ];
  }

  prepareAsset(): Promise<{ metadata: Record<string, unknown> }> {
    // No asset token: the profile token is the only credential.
    return Promise.resolve({ metadata: {} });
  }

  async refreshAccessToken(input: {
    refreshToken: string;
  }): Promise<SocialOrganicOAuthTokenGrant> {
    try {
      return toLongLivedGrant(await this.api.refresh(input.refreshToken));
    } catch (error) {
      if (error instanceof ThreadsApiError && error.code === LOST_GRANT_CODE) {
        throw new SocialOrganicOAuthRefreshError('permanent');
      }
      throw new SocialOrganicOAuthRefreshError('transient');
    }
  }
}
