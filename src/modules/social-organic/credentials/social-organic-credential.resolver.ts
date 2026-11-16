import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import {
  GoogleCredentialError,
  SocialGoogleAuthorizationService,
} from '../../social-google/social-google-authorization.service';
import {
  type SocialOrganicOAuthProviderHooks,
  type SocialOrganicOAuthTokenGrant,
  SocialOrganicOAuthProviderRegistry,
  SocialOrganicOAuthRefreshError,
} from '../connections/social-organic-oauth.provider';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from '../entities';
import { normalizeIanaTimeZone } from '../connections/social-organic-asset-timezone';
import {
  ResolvedOrganicCredential,
  createResolvedOrganicCredential,
} from './resolved-organic-credential';
import {
  SocialOrganicCredentialError,
  type SocialOrganicCredentialErrorCode,
} from './social-organic-credential.error';
import { googleProductForOrganicProvider } from './social-organic-google-products';

const TOKEN_EXPIRY_SKEW_MS = 60_000;
/** D-I5: a refreshable connection token is renewed this close to expiry. */
export const ORGANIC_REFRESH_WINDOW_MS = 5 * 60_000;
/** Bounded wait behind another refresh; mirrors the Google lock timeout. */
const ORGANIC_REFRESH_LOCK_TIMEOUT_MS = 15_000;

type ConnectionToken = { accessToken: string; credentialVersion: number };
type RefreshOutcome =
  | ConnectionToken
  | { refused: SocialOrganicCredentialErrorCode };

export type SocialOrganicCredentialScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId?: string | null;
};

export type ResolveOrganicCredentialInput = SocialOrganicCredentialScope & {
  assetId: string;
};

type ResolvePersistedOrganicCredentialInput = ResolveOrganicCredentialInput;

export type SocialOrganicLifecycleConnectionCredential = {
  accessToken: string | null;
  refreshToken: string | null;
};

export type ResolvedOrganicAnalyticsCredential = {
  credential: ResolvedOrganicCredential;
  assetTimezone: string;
};

/** The only boundary that turns an organic asset row into a usable token. */
@Injectable()
export class SocialOrganicCredentialResolver {
  constructor(
    @InjectRepository(SocialOrganicAssetEntity, 'agency')
    private readonly assetsRepository: Repository<SocialOrganicAssetEntity>,
    @InjectRepository(SocialOrganicConnectionEntity, 'agency')
    private readonly connectionsRepository: Repository<SocialOrganicConnectionEntity>,
    private readonly cryptoService: SettingsCryptoService,
    /** D-I5: source of the optional `refreshAccessToken` hook per provider. */
    @Optional()
    private readonly oauthProviders?: SocialOrganicOAuthProviderRegistry,
    /** D-I1: the only way a `google_oauth` connection gets a token. */
    @Optional()
    private readonly googleAuthorization?: SocialGoogleAuthorizationService,
  ) {}

  async resolve(
    input: ResolveOrganicCredentialInput,
  ): Promise<ResolvedOrganicCredential> {
    const resolved = await this.resolveInternal(input, 'publishing');
    return resolved.credential;
  }

  /**
   * The same decryption boundary for analytics, with analytics-specific
   * eligibility. Publishing enablement is deliberately irrelevant here.
   */
  async resolveForAnalytics(
    input: ResolveOrganicCredentialInput,
  ): Promise<ResolvedOrganicAnalyticsCredential> {
    return this.resolveInternal(input, 'analytics');
  }

  /** Background jobs derive Company Context from the persisted asset itself. */
  async resolvePersistedForAnalytics(
    input: ResolvePersistedOrganicCredentialInput,
  ): Promise<ResolvedOrganicAnalyticsCredential> {
    const asset = await this.assetsRepository.findOne({
      where: {
        id: input.assetId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agencyClientId: input.agencyClientId ?? IsNull(),
      },
      // `id` is selected although only the context is read — see the same
      // guard in `SocialAdCredentialResolver.resolvePersisted`. TypeORM 0.3.28
      // hydrates `findOne` to null when every selected column is NULL in the
      // row, and `companyContextId` is NULL for every agency-owned asset.
      select: ['id', 'companyContextId'],
    });
    if (!asset) throw new SocialOrganicCredentialError('asset_not_found');
    return this.resolveInternal(
      { ...input, companyContextId: asset.companyContextId },
      'analytics',
    );
  }

  private async resolveInternal(
    input: ResolveOrganicCredentialInput,
    purpose: 'publishing' | 'analytics',
  ): Promise<ResolvedOrganicAnalyticsCredential> {
    const asset = await this.findInScope(input);

    if (!asset) {
      throw new SocialOrganicCredentialError('asset_not_found');
    }

    const connection = asset.connection;

    if (connection.credentialRemovedAt) {
      throw new SocialOrganicCredentialError('credential_removed');
    }

    if (connection.connectionStatus !== 'connected') {
      throw new SocialOrganicCredentialError('connection_not_connected');
    }

    if (asset.status !== 'active') {
      throw new SocialOrganicCredentialError('asset_not_active');
    }

    if (purpose === 'publishing' && !asset.isPublishEnabled) {
      throw new SocialOrganicCredentialError('publishing_not_enabled');
    }

    if (asset.provider !== connection.provider) {
      throw new SocialOrganicCredentialError('asset_provider_mismatch');
    }

    let assetTimezone = '';
    if (purpose === 'analytics') {
      if (asset.lastHealthStatus === 'unhealthy') {
        throw new SocialOrganicCredentialError('asset_unhealthy');
      }

      const requiredScope = this.analyticsScopeFor(asset.assetType);
      if (!connection.scopes.includes(requiredScope)) {
        throw new SocialOrganicCredentialError('analytics_scope_missing');
      }

      if (!asset.assetTimezone) {
        throw new SocialOrganicCredentialError('asset_timezone_unresolved');
      }

      try {
        assetTimezone = normalizeIanaTimeZone(asset.assetTimezone) ?? '';
      } catch {
        throw new SocialOrganicCredentialError('asset_timezone_invalid');
      }
      if (!assetTimezone) {
        throw new SocialOrganicCredentialError('asset_timezone_unresolved');
      }
    }

    // Rebuilt from persisted truth. Token queries below never reuse caller data.
    const scope: SocialOrganicCredentialScope = {
      tenantId: asset.tenantId,
      workspaceId: asset.workspaceId,
      agencyClientId: asset.agencyClientId,
      companyContextId: asset.companyContextId,
    };

    let accessToken: string;
    let credentialVersion = connection.credentialVersion;

    // The only runtime branch on authorization_method in the organic module.
    switch (connection.authorizationMethod) {
      case 'oauth_user': {
        const token = await this.resolveConnectionToken(
          connection,
          asset.id,
          scope,
        );
        accessToken = token.accessToken;
        credentialVersion = token.credentialVersion;
        break;
      }

      case 'oauth_business':
      case 'internal_system_user':
        accessToken = await this.resolveAssetToken(asset, scope);
        break;

      case 'google_oauth':
        accessToken = await this.resolveGoogleToken(connection, scope);
        break;

      default:
        throw new SocialOrganicCredentialError(
          'unsupported_authorization_method',
        );
    }

    const credential = createResolvedOrganicCredential({
      assetId: asset.id,
      connectionId: connection.id,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      companyContextId: scope.companyContextId,
      provider: asset.provider,
      assetType: asset.assetType,
      externalAssetId: asset.externalAssetId,
      scopes: connection.scopes,
      credentialVersion,
      accessToken,
    });

    return { credential, assetTimezone };
  }

  /**
   * Lifecycle-only access for a connection row already loaded under a scoped,
   * pessimistic lock. Keeping this here preserves the single decryption
   * boundary while OAuth selection and disconnect handle pre-publish state.
   */
  resolveLifecycleConnectionCredential(
    connection: SocialOrganicConnectionEntity,
  ): SocialOrganicLifecycleConnectionCredential {
    return {
      accessToken: this.decryptOptional(connection.accessTokenEncrypted),
      refreshToken: this.decryptOptional(connection.refreshTokenEncrypted),
    };
  }

  includeLifecycleConnectionCredentials(
    query: SelectQueryBuilder<SocialOrganicConnectionEntity>,
  ): SelectQueryBuilder<SocialOrganicConnectionEntity> {
    return query
      .addSelect('connection.accessTokenEncrypted')
      .addSelect('connection.refreshTokenEncrypted');
  }

  /** Lifecycle-only access for best-effort provider revocation. */
  resolveLifecycleAssetToken(asset: SocialOrganicAssetEntity): string | null {
    return this.decryptOptional(asset.assetTokenEncrypted);
  }

  includeLifecycleAssetCredential(
    query: SelectQueryBuilder<SocialOrganicAssetEntity>,
  ): SelectQueryBuilder<SocialOrganicAssetEntity> {
    return query.addSelect('asset.assetTokenEncrypted');
  }

  private async resolveConnectionToken(
    connection: SocialOrganicConnectionEntity,
    assetId: string,
    scope: SocialOrganicCredentialScope,
  ): Promise<ConnectionToken> {
    const hooks = this.oauthProviders?.find(connection.provider);
    if (
      hooks?.refreshAccessToken &&
      this.isDueForRefresh(connection.tokenExpiresAt)
    ) {
      return this.refreshConnectionToken(connection.id, assetId, scope, hooks);
    }

    this.assertUsableExpiry(connection.tokenExpiresAt);

    const row = await this.whereConnectionInScope(
      this.connectionsRepository
        .createQueryBuilder('connection')
        .select('connection.accessTokenEncrypted'),
      connection.id,
      assetId,
      scope,
    ).getOne();

    return {
      accessToken: this.decryptOrRefuse(row?.accessTokenEncrypted),
      credentialVersion: connection.credentialVersion,
    };
  }

  /**
   * D-I5, molded on `SocialGoogleAuthorizationService.getAccessToken`: the row
   * lock serializes concurrent refreshes. The second caller blocks on it, then
   * re-reads the row and finds the token the first one stored, so one grant
   * is spent per expiry. Everything is re-checked under the lock because a
   * disconnect may have won the race.
   */
  private async refreshConnectionToken(
    connectionId: string,
    assetId: string,
    scope: SocialOrganicCredentialScope,
    hooks: SocialOrganicOAuthProviderHooks,
  ): Promise<ConnectionToken> {
    let outcome: RefreshOutcome;
    try {
      outcome = await this.connectionsRepository.manager.transaction(
        async (manager): Promise<RefreshOutcome> => {
          // SET LOCAL dies with the transaction; never queue forever behind a
          // slow provider call held by another worker.
          await manager.query(
            `SET LOCAL lock_timeout = ${ORGANIC_REFRESH_LOCK_TIMEOUT_MS}`,
          );
          const repository = manager.getRepository(
            SocialOrganicConnectionEntity,
          );
          const locked = await this.whereConnectionInScope(
            this.includeLifecycleConnectionCredentials(
              repository.createQueryBuilder('connection'),
            ),
            connectionId,
            assetId,
            scope,
          )
            .setLock('pessimistic_write')
            .getOne();

          if (!locked || locked.credentialRemovedAt) {
            return { refused: 'credential_removed' };
          }
          if (locked.connectionStatus !== 'connected') {
            return { refused: 'connection_not_connected' };
          }
          if (!this.isDueForRefresh(locked.tokenExpiresAt)) {
            return {
              accessToken: this.decryptOrRefuse(locked.accessTokenEncrypted),
              credentialVersion: locked.credentialVersion,
            };
          }

          const refreshToken = this.decryptOptional(
            locked.refreshTokenEncrypted,
          );
          if (!refreshToken) {
            await this.markCredentialExpired(repository, locked);
            // Returned, not thrown: a throw would roll the new state back.
            return { refused: 'credential_expired' };
          }

          if (!hooks.refreshAccessToken) {
            return { refused: 'credential_refresh_failed' };
          }
          let grant: SocialOrganicOAuthTokenGrant;
          try {
            grant = await hooks.refreshAccessToken({
              loginConfig: hooks.configuration.loginConfig,
              refreshToken,
            });
          } catch (error) {
            if (
              error instanceof SocialOrganicOAuthRefreshError &&
              error.kind === 'permanent'
            ) {
              await this.markCredentialExpired(repository, locked);
              return { refused: 'credential_expired' };
            }
            // Transient: the stored credential is left exactly as it was.
            return { refused: 'credential_refresh_failed' };
          }
          if (!grant.accessToken) {
            return { refused: 'credential_refresh_failed' };
          }

          locked.accessTokenEncrypted = this.cryptoService.encrypt(
            grant.accessToken,
          );
          // Keep the stored refresh token unless the provider rotated it.
          if (grant.refreshToken) {
            locked.refreshTokenEncrypted = this.cryptoService.encrypt(
              grant.refreshToken,
            );
          }
          locked.tokenExpiresAt = grant.tokenExpiresAt ?? null;
          if (grant.scopes?.length) locked.scopes = [...grant.scopes];
          locked.credentialVersion += 1;
          locked.lastError = null;
          await repository.save(locked);

          return {
            accessToken: grant.accessToken,
            credentialVersion: locked.credentialVersion,
          };
        },
      );
    } catch (error) {
      if (error instanceof SocialOrganicCredentialError) throw error;
      // Lock wait timeout (55P03) or any database failure: transient, and
      // never with driver or provider detail attached.
      throw new SocialOrganicCredentialError('credential_refresh_failed');
    }

    if ('refused' in outcome) {
      throw new SocialOrganicCredentialError(outcome.refused);
    }
    return outcome;
  }

  /** The grant is gone: wipe it so nothing retries a dead refresh token. */
  private async markCredentialExpired(
    repository: Repository<SocialOrganicConnectionEntity>,
    connection: SocialOrganicConnectionEntity,
  ): Promise<void> {
    connection.connectionStatus = 'error';
    connection.lastError = 'credential_expired';
    connection.accessTokenEncrypted = null;
    connection.refreshTokenEncrypted = null;
    connection.tokenExpiresAt = null;
    await repository.save(connection);
  }

  /**
   * D-I1: a `google_oauth` connection stores no token; the shared Google
   * authorization refreshes and serializes it. Google codes are mapped to the
   * organic vocabulary so no Google detail escapes this boundary.
   */
  private async resolveGoogleToken(
    connection: SocialOrganicConnectionEntity,
    scope: SocialOrganicCredentialScope,
  ): Promise<string> {
    const product = googleProductForOrganicProvider(connection.provider);
    if (!product || !this.googleAuthorization) {
      throw new SocialOrganicCredentialError(
        'unsupported_authorization_method',
      );
    }

    try {
      const token = await this.googleAuthorization.getAccessToken({
        scope: {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          companyContextId: scope.companyContextId ?? null,
        },
        product,
      });
      return token.accessToken;
    } catch (error) {
      throw new SocialOrganicCredentialError(
        organicCodeForGoogleFailure(error),
      );
    }
  }

  /**
   * D-I2: token for listing a provider's assets before any organic connection
   * exists (YouTube channel discovery). Same boundary as `resolveGoogleToken`:
   * the only caller of `getAccessToken` in this module.
   */
  async resolveGoogleDiscoveryToken(
    scope: SocialOrganicCredentialScope,
    provider: string,
  ): Promise<string> {
    return this.resolveGoogleToken(
      { provider } as SocialOrganicConnectionEntity,
      scope,
    );
  }

  private isDueForRefresh(expiresAt: Date | null): boolean {
    // Unknown expiry keeps today's meaning: a token that does not expire.
    return (
      expiresAt !== null &&
      expiresAt.getTime() - ORGANIC_REFRESH_WINDOW_MS <= Date.now()
    );
  }

  private whereConnectionInScope(
    query: SelectQueryBuilder<SocialOrganicConnectionEntity>,
    connectionId: string,
    assetId: string,
    scope: SocialOrganicCredentialScope,
  ): SelectQueryBuilder<SocialOrganicConnectionEntity> {
    return query
      .where('connection.id = :id', { id: connectionId })
      .andWhere('connection.tenantId = :tenantId', {
        tenantId: scope.tenantId,
      })
      .andWhere('connection.workspaceId = :workspaceId', {
        workspaceId: scope.workspaceId,
      })
      .andWhere(
        scope.agencyClientId === null
          ? 'connection.agencyClientId IS NULL'
          : 'connection.agencyClientId = :agencyClientId',
        scope.agencyClientId === null
          ? {}
          : { agencyClientId: scope.agencyClientId },
      )
      .andWhere(
        scope.companyContextId === null
          ? 'connection.id IN (SELECT scoped_asset.connection_id FROM social_organic_assets scoped_asset WHERE scoped_asset.company_context_id IS NULL AND scoped_asset.id = :assetId)'
          : 'connection.id IN (SELECT scoped_asset.connection_id FROM social_organic_assets scoped_asset WHERE scoped_asset.company_context_id = :companyContextId AND scoped_asset.id = :assetId)',
        scope.companyContextId === null
          ? { assetId }
          : {
              companyContextId: scope.companyContextId,
              assetId,
            },
      );
  }

  private async resolveAssetToken(
    asset: SocialOrganicAssetEntity,
    scope: SocialOrganicCredentialScope,
  ): Promise<string> {
    this.assertUsableExpiry(asset.assetTokenExpiresAt);

    const row = await this.assetsRepository
      .createQueryBuilder('asset')
      .select('asset.assetTokenEncrypted')
      .where('asset.id = :id', { id: asset.id })
      .andWhere('asset.tenantId = :tenantId', { tenantId: scope.tenantId })
      .andWhere('asset.workspaceId = :workspaceId', {
        workspaceId: scope.workspaceId,
      })
      .andWhere(
        scope.agencyClientId === null
          ? 'asset.agencyClientId IS NULL'
          : 'asset.agencyClientId = :agencyClientId',
        scope.agencyClientId === null
          ? {}
          : { agencyClientId: scope.agencyClientId },
      )
      .andWhere(
        scope.companyContextId === null
          ? 'asset.companyContextId IS NULL'
          : 'asset.companyContextId = :companyContextId',
        scope.companyContextId === null
          ? {}
          : { companyContextId: scope.companyContextId },
      )
      .getOne();

    return this.decryptOrRefuse(row?.assetTokenEncrypted);
  }

  private decryptOrRefuse(encrypted: string | null | undefined): string {
    if (!encrypted) {
      throw new SocialOrganicCredentialError('credential_removed');
    }

    try {
      const decrypted = this.cryptoService.decrypt(encrypted);

      if (!decrypted) {
        throw new SocialOrganicCredentialError('credential_removed');
      }

      return decrypted;
    } catch {
      // Missing keys, rotation and corrupted payloads have one safe repair.
      throw new SocialOrganicCredentialError('credential_removed');
    }
  }

  private decryptOptional(encrypted: string | null | undefined): string | null {
    if (!encrypted) return null;

    try {
      return this.cryptoService.decrypt(encrypted) || null;
    } catch {
      return null;
    }
  }

  private assertUsableExpiry(expiresAt: Date | null): void {
    if (expiresAt && expiresAt.getTime() - TOKEN_EXPIRY_SKEW_MS <= Date.now()) {
      throw new SocialOrganicCredentialError('credential_removed');
    }
  }

  private findInScope(input: ResolveOrganicCredentialInput) {
    const agencyClientId = input.agencyClientId ?? IsNull();

    return this.assetsRepository.findOne({
      relations: { connection: true },
      where: {
        id: input.assetId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agencyClientId,
        companyContextId:
          input.companyContextId == null ? IsNull() : input.companyContextId,
        // The FK alone does not guarantee that both rows carry the same scope.
        connection: {
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          agencyClientId,
        },
      },
    });
  }

  private analyticsScopeFor(assetType: string): string {
    switch (assetType) {
      case 'facebook_page':
        return 'read_insights';
      case 'instagram_professional':
        return 'instagram_manage_insights';
      default:
        throw new SocialOrganicCredentialError(
          'unsupported_analytics_asset_type',
        );
    }
  }
}

function organicCodeForGoogleFailure(
  error: unknown,
): SocialOrganicCredentialErrorCode {
  if (!(error instanceof GoogleCredentialError)) {
    return 'credential_refresh_failed';
  }
  switch (error.code) {
    case 'not_connected':
    case 'product_not_connected':
      return 'connection_not_connected';
    case 'reauth_required':
    case 'scope_not_granted':
      return 'credential_expired';
    case 'refresh_failed':
    default:
      return 'credential_refresh_failed';
  }
}
