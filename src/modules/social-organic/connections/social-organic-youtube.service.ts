import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  GoogleApiClient,
  GoogleApiError,
} from '../../social-google/google-api.client';
import { GOOGLE_PRODUCT_REQUIRED_SCOPES } from '../../social-google/google-oauth.constants';
import {
  SocialOrganicCredentialError,
  SocialOrganicCredentialResolver,
} from '../credentials';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from '../entities';
import type { SocialOrganicConnectionScope } from './social-organic-connection.service';
import {
  toSocialOrganicConnectionView,
  type SocialOrganicConnectionView,
} from './views/social-organic-connection.view';

export const YOUTUBE_PROVIDER = 'youtube';
export const YOUTUBE_CHANNEL_ASSET_TYPE = 'youtube_channel';

export type YoutubeChannelCandidateView = {
  channelId: string;
  title: string;
  customUrl: string | null;
  thumbnailUrl: string | null;
  selected: boolean;
};

/**
 * D-I2: YouTube channel discovery and selection. The token never leaves the
 * credential resolver; the organic connection stores none (`google_oauth`).
 * A chosen id is only trusted if it appears in a fresh `channels.list`.
 */
@Injectable()
export class SocialOrganicYoutubeService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly credentials: SocialOrganicCredentialResolver,
    private readonly google: GoogleApiClient,
  ) {}

  async listChannels(scope: SocialOrganicConnectionScope) {
    const channels = await this.discover(scope);
    const selectedIds = await this.selectedChannelIds(scope);
    return {
      channels: channels.map<YoutubeChannelCandidateView>((channel) => ({
        ...channel,
        selected: selectedIds.has(channel.channelId),
      })),
    };
  }

  async select(
    input: SocialOrganicConnectionScope & {
      userId: string | null;
      channelId: string;
    },
  ): Promise<SocialOrganicConnectionView> {
    const channel = (await this.discover(input)).find(
      (candidate) => candidate.channelId === input.channelId,
    );
    if (!channel) throw new BadRequestException('selection_invalid');

    const companyContextId = input.companyContextId ?? null;
    return this.dataSource.transaction(async (manager) => {
      // Serializes concurrent selections of one context.
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `social-organic-youtube:${input.tenantId}:${input.workspaceId}:${input.agencyClientId ?? ''}:${companyContextId ?? ''}`,
      ]);
      const connections = manager.getRepository(SocialOrganicConnectionEntity);
      const assets = manager.getRepository(SocialOrganicAssetEntity);

      const existingAsset = await assets.findOne({
        where: {
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          provider: YOUTUBE_PROVIDER,
          externalAssetId: channel.channelId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        existingAsset &&
        existingAsset.status !== 'revoked' &&
        existingAsset.status !== 'archived' &&
        ((existingAsset.agencyClientId ?? null) !== input.agencyClientId ||
          (existingAsset.companyContextId ?? null) !== companyContextId)
      ) {
        throw new ConflictException('asset_already_connected');
      }

      let connection = await connections
        .createQueryBuilder('connection')
        .where('connection.provider = :provider', {
          provider: YOUTUBE_PROVIDER,
        })
        .andWhere('connection.tenantId = :tenantId', {
          tenantId: input.tenantId,
        })
        .andWhere('connection.workspaceId = :workspaceId', {
          workspaceId: input.workspaceId,
        })
        .andWhere(
          'connection.agencyClientId IS NOT DISTINCT FROM :agencyClientId',
          {
            agencyClientId: input.agencyClientId,
          },
        )
        .andWhere(
          "COALESCE(connection.metadata ->> 'companyContextId', '') = :ctx",
          { ctx: companyContextId ?? '' },
        )
        .andWhere('connection.credentialRemovedAt IS NULL')
        .setLock('pessimistic_write')
        .getOne();

      if (!connection) {
        connection = connections.create({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          agencyClientId: input.agencyClientId,
          provider: YOUTUBE_PROVIDER,
          authorizationMethod: 'google_oauth',
          createdById: input.userId,
        });
      }
      connection.connectionStatus = 'connected';
      connection.accessTokenEncrypted = null;
      connection.refreshTokenEncrypted = null;
      connection.tokenExpiresAt = null;
      connection.scopes = [...GOOGLE_PRODUCT_REQUIRED_SCOPES.youtube];
      connection.lastError = null;
      connection.metadata = {
        ...(connection.metadata ?? {}),
        companyContextId,
        googleProduct: 'youtube',
      };
      connection = await connections.save(connection);

      // One channel per connection: a previous choice is retired.
      const bound = await assets.find({
        where: { connectionId: connection.id },
      });
      for (const other of bound) {
        if (other.externalAssetId === channel.channelId) continue;
        if (other.status === 'revoked') continue;
        other.status = 'revoked';
        other.isPublishEnabled = false;
        await assets.save(other);
      }

      const asset =
        existingAsset ??
        assets.create({
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          agencyClientId: input.agencyClientId,
          provider: YOUTUBE_PROVIDER,
          externalAssetId: channel.channelId,
        });
      asset.connectionId = connection.id;
      asset.companyContextId = companyContextId;
      asset.assetType = YOUTUBE_CHANNEL_ASSET_TYPE;
      asset.displayName = channel.title.slice(0, 240);
      asset.username = channel.customUrl?.slice(0, 180) ?? null;
      asset.avatarUrl = channel.thumbnailUrl;
      asset.assetTokenEncrypted = null;
      asset.assetTokenExpiresAt = null;
      // A channel has no timezone: left NULL (analytics fail closed) until the
      // user sets one through PATCH assets/:id/timezone. Publishing stays off
      // until the YT2 adapter exists.
      asset.assetTimezone = existingAsset?.assetTimezone ?? null;
      asset.isPublishEnabled = false;
      asset.capabilitiesSnapshot = {};
      asset.status = 'active';
      asset.lastHealthCheckAt = null;
      asset.lastHealthStatus = null;
      asset.metadata = {};
      const saved = await assets.save(asset);

      connection.assets = [saved];
      return toSocialOrganicConnectionView(connection);
    });
  }

  private async selectedChannelIds(scope: SocialOrganicConnectionScope) {
    const rows = await this.dataSource
      .getRepository(SocialOrganicAssetEntity)
      .createQueryBuilder('asset')
      .where('asset.provider = :provider', { provider: YOUTUBE_PROVIDER })
      .andWhere("asset.status = 'active'")
      .andWhere('asset.tenantId = :tenantId', { tenantId: scope.tenantId })
      .andWhere('asset.workspaceId = :workspaceId', {
        workspaceId: scope.workspaceId,
      })
      .andWhere('asset.agencyClientId IS NOT DISTINCT FROM :agencyClientId', {
        agencyClientId: scope.agencyClientId,
      })
      .andWhere(
        'asset.companyContextId IS NOT DISTINCT FROM :companyContextId',
        {
          companyContextId: scope.companyContextId ?? null,
        },
      )
      .getMany();
    return new Set(rows.map((row) => row.externalAssetId));
  }

  private async discover(scope: SocialOrganicConnectionScope) {
    try {
      const token = await this.credentials.resolveGoogleDiscoveryToken(
        scope,
        YOUTUBE_PROVIDER,
      );
      return await this.google.listYoutubeChannels(token);
    } catch (error) {
      if (error instanceof SocialOrganicCredentialError) {
        switch (error.code) {
          case 'connection_not_connected':
            throw new NotFoundException('product_not_connected');
          case 'credential_expired':
            throw new ConflictException('reauth_required');
          default:
            throw new ServiceUnavailableException('refresh_failed');
        }
      }
      if (error instanceof GoogleApiError) {
        switch (error.code) {
          case 'reauth_required':
            throw new ConflictException('reauth_required');
          case 'permission_denied':
            throw new ForbiddenException('permission_denied');
          case 'transient':
            throw new ServiceUnavailableException('google_unavailable');
          default:
            throw new BadGatewayException('google_invalid_response');
        }
      }
      throw error;
    }
  }
}
