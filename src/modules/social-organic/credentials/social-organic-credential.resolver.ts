import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from '../entities';
import { normalizeIanaTimeZone } from '../connections/social-organic-asset-timezone';
import {
  ResolvedOrganicCredential,
  createResolvedOrganicCredential,
} from './resolved-organic-credential';
import { SocialOrganicCredentialError } from './social-organic-credential.error';

const TOKEN_EXPIRY_SKEW_MS = 60_000;

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
      select: ['companyContextId'],
    });
    if (!asset) throw new SocialOrganicCredentialError('asset_not_found');
    return this.resolveInternal(
      { ...input, companyContextId: asset.companyContextId },
      'analytics',
    );
  }

  private async resolveInternal(
    input:
      | ResolveOrganicCredentialInput
      | ResolvePersistedOrganicCredentialInput,
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

    // The only runtime branch on authorization_method in the organic module.
    switch (connection.authorizationMethod) {
      case 'oauth_user':
        accessToken = await this.resolveConnectionToken(
          connection,
          asset.id,
          scope,
        );
        break;

      case 'oauth_business':
      case 'internal_system_user':
        accessToken = await this.resolveAssetToken(asset, scope);
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
      credentialVersion: connection.credentialVersion,
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
  ): Promise<string> {
    this.assertUsableExpiry(connection.tokenExpiresAt);

    const row = await this.connectionsRepository
      .createQueryBuilder('connection')
      .select('connection.accessTokenEncrypted')
      .where('connection.id = :id', { id: connection.id })
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
      )
      .getOne();

    return this.decryptOrRefuse(row?.accessTokenEncrypted);
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

  private findInScope(
    input: ResolveOrganicCredentialInput | ResolvePersistedOrganicCredentialInput,
  ) {
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
