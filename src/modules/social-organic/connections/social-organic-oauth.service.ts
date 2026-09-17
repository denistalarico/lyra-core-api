import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import {
  hashOAuthState,
  isAcceptableOAuthState,
} from '../../../common/meta/meta-oauth.support';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from '../entities';
import { SocialOrganicCredentialResolver } from '../credentials';
import {
  SocialOrganicConnectionView,
  readSelectableAssetsForSelection,
  toSocialOrganicConnectionView,
} from './views/social-organic-connection.view';
import {
  SocialOrganicDiscoveredAsset,
  SocialOrganicOAuthCallbackInput,
  SocialOrganicOAuthProviderHooks,
  SocialOrganicOAuthProviderRegistry,
  SocialOrganicOAuthTokenGrant,
} from './social-organic-oauth.provider';
import { normalizeIanaTimeZone } from './social-organic-asset-timezone';
import type { SocialOrganicConnectionMode } from './dto/start-social-organic-connection.dto';

export const SOCIAL_ORGANIC_OAUTH_SESSION_TTL_MS = 15 * 60 * 1000;

export type StartSocialOrganicConnectionInput = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  userId: string | null;
  provider: string;
  connectionMode?: SocialOrganicConnectionMode;
  allowedAssetTypes?: readonly string[];
};

export type HandleSocialOrganicCallbackInput =
  SocialOrganicOAuthCallbackInput & {
    provider: string;
  };

export type SelectSocialOrganicAssetsInput = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  userId: string | null;
  provider: string;
  connectionId: string;
  externalAssetIds: readonly string[];
};

export type SocialOrganicCallbackFailureReason =
  | 'provider_not_configured'
  | 'invalid_state'
  | 'connection_consumed'
  | 'session_expired'
  | 'oauth_denied'
  | 'missing_code'
  | 'token_exchange_failed'
  | 'asset_discovery_failed'
  | 'no_assets_available'
  | 'credential_encryption_failed'
  | 'callback_failed';

type CallbackOutcome =
  | { ok: true; connectionId: string }
  | { ok: false; reason: SocialOrganicCallbackFailureReason };

type SelectionFailureReason =
  | 'invalid_connection'
  | 'connection_consumed'
  | 'connection_expired'
  | 'selection_required'
  | 'asset_not_available'
  | 'asset_already_connected'
  | 'credential_unavailable'
  | 'asset_preparation_failed';

@Injectable()
export class SocialOrganicOAuthService {
  private readonly logger = new Logger(SocialOrganicOAuthService.name);

  constructor(
    @InjectRepository(SocialOrganicConnectionEntity, 'agency')
    private readonly connectionsRepository: Repository<SocialOrganicConnectionEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly cryptoService: SettingsCryptoService,
    private readonly credentialResolver: SocialOrganicCredentialResolver,
    private readonly providers: SocialOrganicOAuthProviderRegistry,
  ) {}

  async start(input: StartSocialOrganicConnectionInput) {
    if (!input.userId) {
      throw new BadRequestException('creator_required');
    }

    const hooks = this.providers.get(input.provider);
    const configuration = hooks.configuration;
    const state = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + SOCIAL_ORGANIC_OAUTH_SESSION_TTL_MS,
    );

    // Resolve every provider-owned setting before creating lifecycle state.
    const authorizationUrl = hooks.buildAuthorizationUrl({
      loginConfig: configuration.loginConfig,
      callbackUrl: configuration.callbackUrl,
      state,
    });

    await this.discardInFlightConnections(input);

    const connection = this.connectionsRepository.create({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agencyClientId: input.agencyClientId,
      provider: configuration.provider,
      connectionStatus: 'pending',
      authorizationMethod: configuration.authorizationMethod,
      credentialVersion: 1,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      tokenExpiresAt: null,
      scopes: [...configuration.scopes],
      oauthStateHash: hashOAuthState(state),
      oauthExpiresAt: expiresAt,
      createdById: input.userId,
      lastError: null,
      metadata: {
        startedAt: new Date().toISOString(),
        ...(input.connectionMode ? { connectionMode: input.connectionMode } : {}),
        ...(input.allowedAssetTypes?.length
          ? { allowedAssetTypes: [...input.allowedAssetTypes] }
          : {}),
      },
      credentialRemovedAt: null,
    });

    await this.connectionsRepository.save(connection);

    return {
      connectionId: connection.id,
      authorizationUrl: authorizationUrl.toString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** Public callback boundary: every failure becomes a fixed redirect code. */
  async handleCallback(
    input: HandleSocialOrganicCallbackInput,
  ): Promise<string> {
    const hooks = await this.resolveCallbackProvider(input);

    if (!hooks) {
      return this.buildFallbackRedirect('provider_not_configured');
    }

    let outcome: CallbackOutcome;

    try {
      outcome = await this.complete(hooks, input);
    } catch (error) {
      this.logger.warn(
        `Organic OAuth callback failed: ${
          error instanceof Error ? error.name : 'unknown_error'
        }`,
      );
      outcome = { ok: false, reason: 'callback_failed' };
    }

    try {
      return this.buildFrontendRedirect(hooks, outcome);
    } catch (error) {
      this.logger.warn(
        `Organic OAuth redirect failed: ${
          error instanceof Error ? error.name : 'unknown_error'
        }`,
      );
      return this.buildFallbackRedirect('callback_failed');
    }
  }

  async select(
    input: SelectSocialOrganicAssetsInput,
  ): Promise<SocialOrganicConnectionView> {
    const hooks = this.providers.get(input.provider);
    const requestedIds = [...new Set(input.externalAssetIds)];

    if (
      requestedIds.length === 0 ||
      requestedIds.length !== input.externalAssetIds.length
    ) {
      throw new BadRequestException(
        'selection_required' satisfies SelectionFailureReason,
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const connections = manager.getRepository(SocialOrganicConnectionEntity);
      const assets = manager.getRepository(SocialOrganicAssetEntity);
      const connectionQuery = this.credentialResolver
        .includeLifecycleConnectionCredentials(
          connections.createQueryBuilder('connection'),
        )
        .where('connection.id = :id', { id: input.connectionId })
        .andWhere('connection.tenantId = :tenantId', {
          tenantId: input.tenantId,
        })
        .andWhere('connection.workspaceId = :workspaceId', {
          workspaceId: input.workspaceId,
        })
        .andWhere('connection.provider = :provider', {
          provider: hooks.configuration.provider,
        });

      this.applyClientScope(connectionQuery, input.agencyClientId);

      const connection = await connectionQuery
        .setLock('pessimistic_write')
        .getOne();

      if (!connection) {
        return { ok: false as const, reason: 'invalid_connection' as const };
      }

      if (connection.connectionStatus !== 'awaiting_selection') {
        return { ok: false as const, reason: 'connection_consumed' as const };
      }

      if (
        !connection.oauthExpiresAt ||
        connection.oauthExpiresAt.getTime() <= Date.now()
      ) {
        return { ok: false as const, reason: 'connection_expired' as const };
      }

      if (
        !connection.createdById ||
        !input.userId ||
        connection.createdById !== input.userId
      ) {
        return { ok: false as const, reason: 'invalid_connection' as const };
      }

      const selectable = readSelectableAssetsForSelection(connection.metadata);
      const selected = requestedIds.map((externalAssetId) =>
        selectable.find((asset) => asset.externalAssetId === externalAssetId),
      );

      if (selected.some((asset) => !asset)) {
        return { ok: false as const, reason: 'asset_not_available' as const };
      }

      const { accessToken } =
        this.credentialResolver.resolveLifecycleConnectionCredential(
          connection,
        );

      if (!accessToken) {
        return {
          ok: false as const,
          reason: 'credential_unavailable' as const,
        };
      }

      const existing = await assets
        .createQueryBuilder('asset')
        .where('asset.tenantId = :tenantId', { tenantId: input.tenantId })
        .andWhere('asset.workspaceId = :workspaceId', {
          workspaceId: input.workspaceId,
        })
        .andWhere('asset.provider = :provider', {
          provider: hooks.configuration.provider,
        })
        .andWhere('asset.externalAssetId IN (:...externalAssetIds)', {
          externalAssetIds: requestedIds,
        })
        .setLock('pessimistic_write')
        .getMany();

      if (
        existing.some(
          (asset) =>
            asset.agencyClientId !== input.agencyClientId ||
            (asset.connectionId !== connection.id &&
              asset.status !== 'revoked' &&
              asset.status !== 'archived'),
        )
      ) {
        return {
          ok: false as const,
          reason: 'asset_already_connected' as const,
        };
      }

      const boundAssets: SocialOrganicAssetEntity[] = [];

      try {
        for (const discovered of selected as SocialOrganicDiscoveredAsset[]) {
          const prepared = await hooks.prepareAsset({
            accessToken,
            asset: discovered,
          });
          const current = existing.find(
            (asset) => asset.externalAssetId === discovered.externalAssetId,
          );
          const asset =
            current ??
            assets.create({
              tenantId: connection.tenantId,
              workspaceId: connection.workspaceId,
              agencyClientId: connection.agencyClientId,
              provider: connection.provider,
              externalAssetId: discovered.externalAssetId,
            });

          asset.connectionId = connection.id;
          asset.connection = connection;
          asset.assetType = discovered.assetType;
          asset.displayName = discovered.displayName ?? null;
          asset.username = discovered.username ?? null;
          asset.avatarUrl = discovered.avatarUrl ?? null;
          const encryptedAssetToken = prepared.accessToken
            ? this.cryptoService.encrypt(prepared.accessToken)
            : null;

          if (prepared.accessToken && !encryptedAssetToken) {
            throw new Error('empty_asset_ciphertext');
          }

          asset.assetTokenEncrypted = encryptedAssetToken;
          asset.assetTokenExpiresAt = prepared.tokenExpiresAt ?? null;
          const preparedTimezone = normalizeIanaTimeZone(
            prepared.assetTimezone,
          );
          // An absent provider value is not permission to erase a previously
          // configured, validated timezone during re-authorization. New rows
          // remain NULL. Metadata is deliberately never inspected here.
          asset.assetTimezone =
            preparedTimezone ?? current?.assetTimezone ?? null;
          asset.isPublishEnabled = true;
          asset.capabilitiesSnapshot = discovered.capabilities ?? {};
          asset.status = 'active';
          asset.lastHealthCheckAt = null;
          asset.lastHealthStatus = null;
          asset.metadata = prepared.metadata ?? {};
          boundAssets.push(asset);
        }
      } catch {
        return {
          ok: false as const,
          reason: 'asset_preparation_failed' as const,
        };
      }

      await assets.save(boundAssets);

      connection.connectionStatus = 'connected';
      connection.oauthStateHash = null;
      connection.oauthExpiresAt = null;
      connection.lastError = null;
      connection.credentialRemovedAt = null;
      connection.metadata = {
        ...connection.metadata,
        selectableAssets: undefined,
        connectedAt: new Date().toISOString(),
      };
      connection.assets = boundAssets;
      await connections.save(connection);

      return { ok: true as const, connection };
    });

    if (!result.ok) {
      throw new BadRequestException(
        result.reason satisfies SelectionFailureReason,
      );
    }

    return toSocialOrganicConnectionView(result.connection);
  }

  private async complete(
    hooks: SocialOrganicOAuthProviderHooks,
    input: SocialOrganicOAuthCallbackInput,
  ): Promise<CallbackOutcome> {
    if (!isAcceptableOAuthState(input.state)) {
      return { ok: false, reason: 'invalid_state' };
    }

    const stateHash = hashOAuthState(input.state);

    return this.dataSource.transaction(async (manager) => {
      const connections = manager.getRepository(SocialOrganicConnectionEntity);
      const connection = await connections
        .createQueryBuilder('connection')
        .where('connection.oauthStateHash = :stateHash', { stateHash })
        .andWhere('connection.provider = :provider', {
          provider: hooks.configuration.provider,
        })
        .setLock('pessimistic_write')
        .getOne();

      if (!connection) return { ok: false, reason: 'invalid_state' };

      if (connection.connectionStatus !== 'pending') {
        return { ok: false, reason: 'connection_consumed' };
      }

      if (
        !connection.oauthExpiresAt ||
        connection.oauthExpiresAt.getTime() <= Date.now()
      ) {
        await this.failConnection(connections, connection, 'session_expired');
        return { ok: false, reason: 'session_expired' };
      }

      if (input.error || input.errorReason || input.errorDescription) {
        await this.failConnection(connections, connection, 'oauth_denied');
        return { ok: false, reason: 'oauth_denied' };
      }

      if (!input.code) {
        await this.failConnection(connections, connection, 'missing_code');
        return { ok: false, reason: 'missing_code' };
      }

      let grant: SocialOrganicOAuthTokenGrant;

      try {
        grant = await hooks.exchangeCode({
          loginConfig: hooks.configuration.loginConfig,
          callbackUrl: hooks.configuration.callbackUrl,
          code: input.code,
        });

        if (!grant.accessToken?.trim()) throw new Error('empty_grant');
      } catch {
        await this.failConnection(
          connections,
          connection,
          'token_exchange_failed',
        );
        return { ok: false, reason: 'token_exchange_failed' };
      }

      let discovered: readonly SocialOrganicDiscoveredAsset[];

      try {
        discovered = await hooks.discoverAssets({
          accessToken: grant.accessToken,
        });
      } catch {
        await this.failConnection(
          connections,
          connection,
          'asset_discovery_failed',
        );
        return { ok: false, reason: 'asset_discovery_failed' };
      }

      const allowedAssetTypes = this.readAllowedAssetTypes(connection.metadata);
      const selectable = this.normalizeDiscoveredAssets(discovered).filter(
        (asset) =>
          allowedAssetTypes.length === 0 ||
          allowedAssetTypes.includes(asset.assetType),
      );

      if (selectable.length === 0) {
        await this.failConnection(
          connections,
          connection,
          'no_assets_available',
        );
        return { ok: false, reason: 'no_assets_available' };
      }

      try {
        const encryptedAccessToken = this.cryptoService.encrypt(
          grant.accessToken,
        );
        const encryptedRefreshToken = grant.refreshToken
          ? this.cryptoService.encrypt(grant.refreshToken)
          : null;

        if (
          !encryptedAccessToken ||
          (grant.refreshToken && !encryptedRefreshToken)
        ) {
          throw new Error('empty_ciphertext');
        }

        connection.accessTokenEncrypted = encryptedAccessToken;
        connection.refreshTokenEncrypted = encryptedRefreshToken;
      } catch {
        await this.failConnection(
          connections,
          connection,
          'credential_encryption_failed',
        );
        return { ok: false, reason: 'credential_encryption_failed' };
      }

      connection.connectionStatus = 'awaiting_selection';
      connection.tokenExpiresAt = grant.tokenExpiresAt ?? null;
      connection.scopes = [...(grant.scopes ?? hooks.configuration.scopes)];
      connection.lastError = null;
      // Single use: the second callback cannot find this row after commit.
      connection.oauthStateHash = null;
      connection.metadata = {
        ...connection.metadata,
        discoveredAt: new Date().toISOString(),
        selectableAssets: selectable,
      };
      await connections.save(connection);

      return { ok: true, connectionId: connection.id };
    });
  }

  private normalizeDiscoveredAssets(
    discovered: readonly SocialOrganicDiscoveredAsset[],
  ): SocialOrganicDiscoveredAsset[] {
    const seen = new Set<string>();
    const normalized: SocialOrganicDiscoveredAsset[] = [];

    for (const asset of discovered) {
      const externalAssetId = asset.externalAssetId?.trim();
      const assetType = asset.assetType?.trim();

      if (!externalAssetId || !assetType || seen.has(externalAssetId)) continue;

      seen.add(externalAssetId);
      normalized.push({
        externalAssetId,
        assetType,
        displayName: asset.displayName?.trim() || null,
        username: asset.username?.trim() || null,
        avatarUrl: asset.avatarUrl?.trim() || null,
        capabilities: asset.capabilities ?? {},
        selectionData: asset.selectionData ?? {},
      });
    }

    return normalized;
  }

  private async discardInFlightConnections(
    input: StartSocialOrganicConnectionInput,
  ): Promise<void> {
    // Compatibility path for lifecycle callers created before connector modes.
    // Browser requests always carry a mode and use the narrower query below.
    if (!input.connectionMode) {
      await this.connectionsRepository.delete({
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agencyClientId: input.agencyClientId ?? IsNull(),
        provider: input.provider,
        connectionStatus: In(['pending', 'awaiting_selection', 'error']),
      });
      return;
    }

    const query = this.connectionsRepository
      .createQueryBuilder()
      .delete()
      .where('tenant_id = :tenantId', { tenantId: input.tenantId })
      .andWhere('workspace_id = :workspaceId', { workspaceId: input.workspaceId })
      .andWhere('provider = :provider', { provider: input.provider })
      .andWhere("connection_status IN ('pending', 'awaiting_selection', 'error')");

    if (input.connectionMode) {
      query.andWhere("metadata ->> 'connectionMode' = :connectionMode", {
        connectionMode: input.connectionMode,
      });
    }

    if (input.agencyClientId) {
      query.andWhere('agency_client_id = :agencyClientId', {
        agencyClientId: input.agencyClientId,
      });
    } else {
      query.andWhere('agency_client_id IS NULL');
    }

    await query.execute();
  }

  private async resolveCallbackProvider(
    input: HandleSocialOrganicCallbackInput,
  ): Promise<SocialOrganicOAuthProviderHooks | undefined> {
    const hinted = this.providers.find(input.provider);
    if (!isAcceptableOAuthState(input.state)) {
      return hinted;
    }

    // Both Meta products may be registered with the same Organic callback
    // URL. Only the `/meta/callback` alias needs state-based resolution; a
    // dedicated `/instagram/callback` remains a direct registry lookup.
    if (input.provider !== 'meta' || !hinted) {
      return hinted;
    }

    const connection = await this.connectionsRepository.findOne({
      select: { provider: true },
      where: { oauthStateHash: hashOAuthState(input.state) },
    });

    return connection
      ? this.providers.find(connection.provider)
      : hinted;
  }

  private readAllowedAssetTypes(metadata: Record<string, unknown>): string[] {
    const raw = metadata.allowedAssetTypes;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (assetType): assetType is string =>
        typeof assetType === 'string' && assetType.trim().length > 0,
    );
  }

  private async failConnection(
    connections: Repository<SocialOrganicConnectionEntity>,
    connection: SocialOrganicConnectionEntity,
    reason: SocialOrganicCallbackFailureReason,
  ): Promise<void> {
    connection.connectionStatus = 'error';
    connection.lastError = reason;
    connection.oauthStateHash = null;
    connection.accessTokenEncrypted = null;
    connection.refreshTokenEncrypted = null;
    connection.metadata = {
      ...connection.metadata,
      failedAt: new Date().toISOString(),
      failedStep: reason,
    };
    await connections.save(connection);
  }

  private applyClientScope(
    query: ReturnType<
      Repository<SocialOrganicConnectionEntity>['createQueryBuilder']
    >,
    agencyClientId: string | null,
  ): void {
    if (agencyClientId) {
      query.andWhere('connection.agencyClientId = :agencyClientId', {
        agencyClientId,
      });
    } else {
      query.andWhere('connection.agencyClientId IS NULL');
    }
  }

  private buildFrontendRedirect(
    hooks: SocialOrganicOAuthProviderHooks,
    outcome: CallbackOutcome,
  ): string {
    const redirect = new URL(
      hooks.configuration.frontendRedirectUrl.toString(),
    );
    redirect.searchParams.set('integration', 'social-organic');
    redirect.searchParams.set('provider', hooks.configuration.provider);

    if (outcome.ok) {
      redirect.searchParams.set('status', 'select_assets');
      redirect.searchParams.set('connection', outcome.connectionId);
    } else {
      redirect.searchParams.set('status', 'error');
      redirect.searchParams.set('reason', outcome.reason);
    }

    return redirect.toString();
  }

  private buildFallbackRedirect(reason: SocialOrganicCallbackFailureReason) {
    const params = new URLSearchParams({
      integration: 'social-organic',
      status: 'error',
      reason,
    });

    return `/social/settings?${params.toString()}`;
  }
}
