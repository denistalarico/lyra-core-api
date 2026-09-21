import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  SocialOrganicAssetEntity,
  SocialOrganicConnectionEntity,
} from '../../entities';
import { SocialOrganicCredentialResolver } from '../../credentials/social-organic-credential.resolver';
import { SocialOrganicCredentialError } from '../../credentials/social-organic-credential.error';
import { MetaOrganicGraphService } from './meta-organic-graph.service';
import { MetaOrganicGraphError } from './meta-organic-graph.error';
import {
  HEALTH_NEAR_EXPIRY_MS,
  requiredPublishingScopes,
  type MetaOrganicHealthReason,
  type MetaOrganicHealthStatus,
} from './meta-organic-health.support';

export type MetaOrganicHealthScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId?: string | null;
};

export type MetaOrganicHealthCheckInput = MetaOrganicHealthScope & {
  assetId: string;
};

export type MetaOrganicHealthResult = {
  assetId: string;
  status: MetaOrganicHealthStatus;
  reason: MetaOrganicHealthReason;
  checkedAt: Date;
};

/**
 * `MA4` — per-asset "can this still publish?" for Meta Organic.
 *
 * Read-only. Never publishes, deletes or creates anything against Meta.
 * Reuses `SocialOrganicCredentialResolver` as the single credential/
 * authorization-method boundary (F3) rather than branching on
 * `authorizationMethod` a second time here.
 */
@Injectable()
export class MetaOrganicHealthService {
  constructor(
    @InjectRepository(SocialOrganicAssetEntity, 'agency')
    private readonly assetsRepository: Repository<SocialOrganicAssetEntity>,
    private readonly credentialResolver: SocialOrganicCredentialResolver,
    private readonly graph: MetaOrganicGraphService,
  ) {}

  async checkAsset(
    input: MetaOrganicHealthCheckInput,
  ): Promise<MetaOrganicHealthResult> {
    const asset = await this.findInScope(input);
    if (!asset) throw new NotFoundException('Social organic asset not found.');

    return this.runCheck(asset);
  }

  /**
   * Assets the scheduler should spend a Graph call on: locally active and
   * publish-enabled, on a connection that is actually `connected` with no
   * credential removal recorded. A disconnected/archived/disabled asset has
   * nothing a Meta round-trip could usefully learn.
   */
  async listEligibleForScheduledCheck(): Promise<SocialOrganicAssetEntity[]> {
    return this.assetsRepository.find({
      relations: { connection: true },
      where: {
        status: 'active',
        isPublishEnabled: true,
        connection: {
          connectionStatus: 'connected',
          credentialRemovedAt: IsNull(),
        },
      },
    });
  }

  async runCheck(
    asset: SocialOrganicAssetEntity,
  ): Promise<MetaOrganicHealthResult> {
    const checkedAt = new Date();
    const { status, reason } = await this.classify(asset);

    await this.persist(asset.id, status, checkedAt);

    return { assetId: asset.id, status, reason, checkedAt };
  }

  private async classify(asset: SocialOrganicAssetEntity): Promise<{
    status: MetaOrganicHealthStatus;
    reason: MetaOrganicHealthReason;
  }> {
    const connection = asset.connection;

    if (connection.connectionStatus === 'disconnected') {
      return { status: 'unhealthy', reason: 'connection_disconnected' };
    }
    if (connection.credentialRemovedAt) {
      return { status: 'unhealthy', reason: 'credential_removed' };
    }
    if (asset.status !== 'active' || !asset.isPublishEnabled) {
      // Locally disabled, not a Meta-side signal — the brief's safe
      // vocabulary has no dedicated code for this, and `unknown` is the
      // fail-closed choice rather than reusing `connection_disconnected`
      // for a cause it did not actually observe.
      return { status: 'unhealthy', reason: 'unknown' };
    }

    const requiredScopes = requiredPublishingScopes(asset.assetType);
    if (requiredScopes === null) {
      // Fail closed on an asset type with no researched/citable scope
      // requirement — never a silent "assume it's fine".
      return { status: 'unhealthy', reason: 'unknown' };
    }
    const missingScope = requiredScopes.some(
      (scope) => !connection.scopes.includes(scope),
    );
    if (missingScope) {
      return { status: 'unhealthy', reason: 'permission_lost' };
    }

    const expiryStatus = this.classifyExpiry(asset, connection);
    if (expiryStatus === 'unhealthy') {
      return { status: 'unhealthy', reason: 'credential_expired' };
    }

    let credential: Awaited<
      ReturnType<SocialOrganicCredentialResolver['resolve']>
    >;
    try {
      credential = await this.credentialResolver.resolve({
        tenantId: asset.tenantId,
        workspaceId: asset.workspaceId,
        agencyClientId: asset.agencyClientId,
        companyContextId: asset.companyContextId,
        assetId: asset.id,
      });
    } catch (error) {
      return this.classifyCredentialError(error);
    }

    const reachable = await this.probeReachable(credential.accessToken, asset);
    if (!reachable.ok) return reachable.result;

    return expiryStatus === 'degraded'
      ? { status: 'degraded', reason: 'expires_soon' }
      : { status: 'healthy', reason: 'ok' };
  }

  /**
   * `oauth_user` publishes with the connection-level user token;
   * `oauth_business`/`internal_system_user` publish with the asset-level
   * token — `SocialOrganicCredentialResolver` branches the same way, and a
   * Page/IG asset token has no expiry semantics guaranteed equal to a user
   * token's (blueprint trap T9), so health must read the same field the
   * resolver would actually use rather than assume one shared expiry.
   */
  private classifyExpiry(
    asset: SocialOrganicAssetEntity,
    connection: SocialOrganicConnectionEntity,
  ): 'ok' | 'degraded' | 'unhealthy' {
    const expiresAt =
      connection.authorizationMethod === 'oauth_user'
        ? connection.tokenExpiresAt
        : asset.assetTokenExpiresAt;

    // No known expiry does not invent one — never synthesize a degraded state
    // from an absence of data.
    if (!expiresAt) return 'ok';

    const remainingMs = expiresAt.getTime() - Date.now();
    if (remainingMs <= 0) return 'unhealthy';
    if (remainingMs <= HEALTH_NEAR_EXPIRY_MS) return 'degraded';
    return 'ok';
  }

  private classifyCredentialError(error: unknown): {
    status: MetaOrganicHealthStatus;
    reason: MetaOrganicHealthReason;
  } {
    if (error instanceof SocialOrganicCredentialError) {
      switch (error.code) {
        case 'credential_removed':
          return { status: 'unhealthy', reason: 'credential_removed' };
        case 'connection_not_connected':
          return { status: 'unhealthy', reason: 'connection_disconnected' };
        case 'asset_not_active':
        case 'publishing_not_enabled':
        case 'asset_provider_mismatch':
        case 'unsupported_authorization_method':
          return { status: 'unhealthy', reason: 'unknown' };
        default:
          return { status: 'unhealthy', reason: 'unknown' };
      }
    }
    return { status: 'unhealthy', reason: 'unknown' };
  }

  /**
   * Lowest-privilege Graph read, proving the credential still resolves to
   * *this* asset. Transient/rate-limited/5xx failures never downgrade to
   * "revoked" — that would turn a temporary Meta outage into a false
   * disconnect signal for every asset checked during it.
   */
  private async probeReachable(
    accessToken: string,
    asset: SocialOrganicAssetEntity,
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        result: {
          status: MetaOrganicHealthStatus;
          reason: MetaOrganicHealthReason;
        };
      }
  > {
    try {
      const id = await this.graph.getObjectId({
        objectId: asset.externalAssetId,
        accessToken,
      });
      if (id !== asset.externalAssetId) {
        return {
          ok: false,
          result: { status: 'unhealthy', reason: 'asset_unreachable' },
        };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, result: this.classifyGraphError(error) };
    }
  }

  private classifyGraphError(error: unknown): {
    status: MetaOrganicHealthStatus;
    reason: MetaOrganicHealthReason;
  } {
    if (!(error instanceof MetaOrganicGraphError)) {
      return { status: 'unhealthy', reason: 'unknown' };
    }

    switch (error.kind) {
      case 'credential_invalid':
        return { status: 'unhealthy', reason: 'credential_expired' };
      case 'permission_denied':
        return { status: 'unhealthy', reason: 'permission_lost' };
      case 'permanent':
        return { status: 'unhealthy', reason: 'asset_unreachable' };
      case 'rate_limited':
      case 'transient':
        // Meta being slow or throttling right now is not evidence the asset
        // was revoked. Fail closed on the safe side: degrade, do not disable.
        return { status: 'degraded', reason: 'provider_unavailable' };
      default:
        return { status: 'unhealthy', reason: 'unknown' };
    }
  }

  private async persist(
    assetId: string,
    status: MetaOrganicHealthStatus,
    checkedAt: Date,
  ): Promise<void> {
    await this.assetsRepository.update(
      { id: assetId },
      { lastHealthStatus: status, lastHealthCheckAt: checkedAt },
    );
  }

  private findInScope(input: MetaOrganicHealthCheckInput) {
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
        connection: {
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          agencyClientId,
        },
      },
    });
  }
}
