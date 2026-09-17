import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { SocialOrganicCredentialResolver } from '../credentials';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from '../entities';
import { normalizeIanaTimeZone } from './social-organic-asset-timezone';
import { SocialOrganicOAuthProviderRegistry } from './social-organic-oauth.provider';
import {
  SocialOrganicAssetView,
  SocialOrganicConnectionView,
  toSocialOrganicAssetView,
  toSocialOrganicConnectionView,
} from './views/social-organic-connection.view';

export const SOCIAL_ORGANIC_PUBLICATION_CANCELLATION_HOOK = Symbol(
  'SOCIAL_ORGANIC_PUBLICATION_CANCELLATION_HOOK',
);

export type SocialOrganicConnectionScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
};

export type DisconnectSocialOrganicConnectionInput =
  SocialOrganicConnectionScope & {
    connectionId: string;
  };

export type UpdateSocialOrganicAssetTimezoneInput =
  SocialOrganicConnectionScope & {
    assetId: string;
    timezone: string | null;
  };

/** P1 implements this contract without making F6 depend on publication code. */
export interface SocialOrganicPublicationCancellationHook {
  cancelForAssets(input: {
    manager: EntityManager;
    scope: SocialOrganicConnectionScope;
    assetIds: readonly string[];
    reason: 'connection_disconnected';
  }): Promise<void>;
}

@Injectable()
export class SocialOrganicConnectionService {
  private readonly logger = new Logger(SocialOrganicConnectionService.name);

  constructor(
    @InjectRepository(SocialOrganicConnectionEntity, 'agency')
    private readonly connectionsRepository: Repository<SocialOrganicConnectionEntity>,
    @InjectRepository(SocialOrganicAssetEntity, 'agency')
    private readonly assetsRepository: Repository<SocialOrganicAssetEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly credentialResolver: SocialOrganicCredentialResolver,
    private readonly providers: SocialOrganicOAuthProviderRegistry,
    @Optional()
    @Inject(SOCIAL_ORGANIC_PUBLICATION_CANCELLATION_HOOK)
    private readonly publicationCancellation?: SocialOrganicPublicationCancellationHook,
  ) {}

  async list(
    input: SocialOrganicConnectionScope,
  ): Promise<SocialOrganicConnectionView[]> {
    const now = new Date();
    const query = this.connectionsRepository
      .createQueryBuilder('connection')
      .leftJoinAndSelect('connection.assets', 'asset')
      .where('connection.tenantId = :tenantId', { tenantId: input.tenantId })
      .andWhere('connection.workspaceId = :workspaceId', {
        workspaceId: input.workspaceId,
      });

    this.applyClientScope(query, input.agencyClientId);
    // A disconnected row is retained for publication audit integrity, but it
    // is never a reconnect card. New OAuth state replaces the visible flow.
    query.andWhere('connection.credentialRemovedAt IS NULL');
    query.andWhere(
      "(connection.connectionStatus NOT IN ('pending', 'awaiting_selection') OR connection.oauthExpiresAt > :now)",
      { now },
    );

    const connections = await query
      .orderBy('connection.createdAt', 'DESC')
      .addOrderBy('asset.createdAt', 'ASC')
      .getMany();

    return connections.map(toSocialOrganicConnectionView);
  }

  /**
   * Best-effort provider revocation followed by transactional credential
   * removal, asset revocation and queued-publication cancellation.
   */
  async disconnect(
    input: DisconnectSocialOrganicConnectionInput,
  ): Promise<SocialOrganicConnectionView> {
    return this.dataSource.transaction(async (manager) => {
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
        });

      this.applyClientScope(connectionQuery, input.agencyClientId);

      const connection = await connectionQuery
        .setLock('pessimistic_write')
        .getOne();

      if (!connection) throw new NotFoundException('Connection not found.');

      const assetQuery = this.credentialResolver
        .includeLifecycleAssetCredential(assets.createQueryBuilder('asset'))
        .where('asset.connectionId = :connectionId', {
          connectionId: connection.id,
        })
        .andWhere('asset.tenantId = :tenantId', {
          tenantId: input.tenantId,
        })
        .andWhere('asset.workspaceId = :workspaceId', {
          workspaceId: input.workspaceId,
        });

      this.applyAssetClientScope(assetQuery, input.agencyClientId);
      const boundAssets = await assetQuery
        .setLock('pessimistic_write')
        .getMany();

      const hooks = this.providers.find(connection.provider);

      if (hooks?.revokeAuthorization) {
        try {
          const connectionCredential =
            this.credentialResolver.resolveLifecycleConnectionCredential(
              connection,
            );
          await hooks.revokeAuthorization({
            connectionAccessToken: connectionCredential.accessToken,
            refreshToken: connectionCredential.refreshToken,
            assets: boundAssets.map((asset) => ({
              externalAssetId: asset.externalAssetId,
              accessToken:
                this.credentialResolver.resolveLifecycleAssetToken(asset),
            })),
          });
        } catch (error) {
          this.logger.warn(
            `Organic authorization revocation failed: ${
              error instanceof Error ? error.name : 'unknown_error'
            }`,
          );
        }
      }

      const disconnectedAt = new Date();

      connection.connectionStatus = 'disconnected';
      connection.credentialRemovedAt = disconnectedAt;
      connection.accessTokenEncrypted = null;
      connection.refreshTokenEncrypted = null;
      connection.tokenExpiresAt = null;
      connection.oauthStateHash = null;
      connection.oauthExpiresAt = null;
      connection.scopes = [];
      connection.lastError = null;
      connection.metadata = {
        ...connection.metadata,
        selectableAssets: undefined,
        disconnectedAt: disconnectedAt.toISOString(),
      };

      for (const asset of boundAssets) {
        asset.assetTokenEncrypted = null;
        asset.assetTokenExpiresAt = null;
        asset.isPublishEnabled = false;
        asset.status = 'revoked';
      }

      await assets.save(boundAssets);
      await connections.save(connection);

      if (this.publicationCancellation && boundAssets.length > 0) {
        await this.publicationCancellation.cancelForAssets({
          manager,
          scope: {
            tenantId: connection.tenantId,
            workspaceId: connection.workspaceId,
            agencyClientId: connection.agencyClientId,
          },
          assetIds: boundAssets.map((asset) => asset.id),
          reason: 'connection_disconnected',
        });
      }

      connection.assets = boundAssets;
      return toSocialOrganicConnectionView(connection);
    });
  }

  /**
   * The only writer of `asset_timezone`. Never inherits a server, tenant,
   * workspace or Planner timezone — the caller must supply a validated IANA
   * zone or explicit `null`, and only that column plus `updated_at` change.
   */
  async updateAssetTimezone(
    input: UpdateSocialOrganicAssetTimezoneInput,
  ): Promise<SocialOrganicAssetView> {
    let normalized: string | null;
    try {
      normalized = normalizeIanaTimeZone(input.timezone);
    } catch {
      throw new BadRequestException('invalid_asset_timezone');
    }

    const asset = await this.assetsRepository.findOne({
      where: {
        id: input.assetId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        agencyClientId: input.agencyClientId ?? IsNull(),
      },
    });

    if (!asset) throw new NotFoundException('Social organic asset not found.');

    asset.assetTimezone = normalized;
    await this.assetsRepository.save(asset);

    return toSocialOrganicAssetView(asset);
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

  private applyAssetClientScope(
    query: ReturnType<
      Repository<SocialOrganicAssetEntity>['createQueryBuilder']
    >,
    agencyClientId: string | null,
  ): void {
    if (agencyClientId) {
      query.andWhere('asset.agencyClientId = :agencyClientId', {
        agencyClientId,
      });
    } else {
      query.andWhere('asset.agencyClientId IS NULL');
    }
  }
}
