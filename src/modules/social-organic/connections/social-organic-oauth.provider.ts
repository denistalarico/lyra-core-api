import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import type { SocialOrganicAuthorizationMethod } from '../entities';

export const SOCIAL_ORGANIC_OAUTH_PROVIDERS = Symbol(
  'SOCIAL_ORGANIC_OAUTH_PROVIDERS',
);

export type SocialOrganicOAuthProviderConfiguration = {
  /** Stable persisted provider key. */
  provider: string;
  authorizationMethod: SocialOrganicAuthorizationMethod;
  scopes: readonly string[];
  /** Opaque configuration interpreted only by the provider hook. */
  loginConfig: unknown;
  /** Exact backend redirect URI registered with this provider. */
  callbackUrl: URL;
  /** Exact frontend landing URL for callback outcomes. */
  frontendRedirectUrl: URL;
};

export type SocialOrganicOAuthCallbackInput = {
  state?: string;
  code?: string;
  error?: string;
  errorReason?: string;
  errorDescription?: string;
};

export type SocialOrganicOAuthTokenGrant = {
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
  scopes?: readonly string[];
};

export type SocialOrganicDiscoveredAsset = {
  externalAssetId: string;
  assetType: string;
  displayName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  capabilities?: Record<string, unknown>;
  /** Opaque, non-secret data needed by the selection hook. */
  selectionData?: Record<string, unknown>;
};

export type SocialOrganicPreparedAsset = {
  accessToken?: string | null;
  tokenExpiresAt?: Date | null;
  /** Provider-confirmed IANA timezone only; never inferred from metadata. */
  assetTimezone?: string | null;
  metadata?: Record<string, unknown>;
};

export type SocialOrganicRevocationInput = {
  connectionAccessToken: string | null;
  refreshToken: string | null;
  assets: ReadonlyArray<{
    externalAssetId: string;
    accessToken: string | null;
  }>;
};

/** Provider-owned operations. The lifecycle service contains no provider branches. */
export interface SocialOrganicOAuthProviderHooks {
  readonly configuration: SocialOrganicOAuthProviderConfiguration;

  buildAuthorizationUrl(input: {
    loginConfig: unknown;
    callbackUrl: URL;
    state: string;
  }): URL | string;

  exchangeCode(input: {
    loginConfig: unknown;
    callbackUrl: URL;
    code: string;
  }): Promise<SocialOrganicOAuthTokenGrant>;

  discoverAssets(input: {
    accessToken: string;
  }): Promise<readonly SocialOrganicDiscoveredAsset[]>;

  prepareAsset(input: {
    accessToken: string;
    asset: SocialOrganicDiscoveredAsset;
  }): Promise<SocialOrganicPreparedAsset>;

  revokeAuthorization?(input: SocialOrganicRevocationInput): Promise<void>;
}

@Injectable()
export class SocialOrganicOAuthProviderRegistry {
  private readonly providers: ReadonlyMap<
    string,
    SocialOrganicOAuthProviderHooks
  >;

  constructor(
    @Optional()
    @Inject(SOCIAL_ORGANIC_OAUTH_PROVIDERS)
    providers: readonly SocialOrganicOAuthProviderHooks[] = [],
  ) {
    const byKey = new Map<string, SocialOrganicOAuthProviderHooks>();

    for (const provider of providers) {
      const key = provider.configuration.provider.trim();

      if (!key || byKey.has(key)) {
        throw new Error('Organic OAuth provider keys must be unique.');
      }

      byKey.set(key, provider);
    }

    this.providers = byKey;
  }

  find(provider: string): SocialOrganicOAuthProviderHooks | undefined {
    return this.providers.get(provider);
  }

  get(provider: string): SocialOrganicOAuthProviderHooks {
    const hooks = this.find(provider);

    if (!hooks) {
      throw new BadRequestException('provider_not_configured');
    }

    return hooks;
  }
}
