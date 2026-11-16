import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { clientAreaOAuthRedirect } from '../../../common/client-area-bridge/client-area-oauth-redirect';
import {
  ClientAreaSettingsRegistry,
  type ClientAreaOAuthBinding,
} from '../../../common/client-area-bridge/client-area-settings.registry';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import {
  TikTokAdsCallbackInput,
  buildTikTokAuthorizationUrl,
  hashOAuthState,
  isAcceptableOAuthState,
  readTikTokAdsAppConfig,
  requireTikTokAdsCallbackUrl,
} from '../oauth/tiktok-ads-oauth.support';
import { requireSocialFrontendUrl } from '../oauth/meta-ads-oauth.support';
import {
  readAccountOptions,
  toSocialAdConnectionView,
} from '../views/social-ad-connection.view';
import { TikTokAdsApiClient } from './tiktok-ads-api.client';
import { SocialAdBackfillPlannerService } from './social-ad-backfill-planner.service';

const PROVIDER = 'tiktok_ads' as const;
const SESSION_TTL_MS = 15 * 60 * 1000;
const CHANNEL_PATH = '/social/channels/tiktokads';
/** The grant is configured on the app in the TikTok portal, not per request. */
const SCOPES: string[] = [];

export type StartTikTokAdsConnectionInput = {
  clientAreaBinding?: ClientAreaOAuthBinding;
  tenantId: string;
  workspaceId: string;
  userId: string | null;
  agencyClientId?: string | null;
  companyContextId?: string | null;
};

export type SelectTikTokAdsAccountInput = {
  clientAreaSessionId?: string;
  tenantId: string;
  workspaceId: string;
  agencyClientId?: string | null;
  companyContextId?: string | null;
  userId: string | null;
  connectionId: string;
  externalAccountId: string;
};

type CallbackOutcome =
  | { ok: true; connectionId: string }
  | { ok: false; reason: string };

type SelectionErrorCode =
  | 'invalid_connection'
  | 'connection_expired'
  | 'connection_consumed'
  | 'account_not_available'
  | 'account_already_connected'
  | 'credential_decryption_failed';

/**
 * TikTok Ads connection (advertiser authorization of TikTok API for Business)
 * and the selection of the advertiser to mirror (D-I7). Same lifecycle as the Meta flow:
 * `pending` → `awaiting_selection` → `connected`, with the single-use state
 * hashed at rest and the token encrypted in the row.
 */
@Injectable()
export class TikTokAdsOAuthService {
  private readonly logger = new Logger(TikTokAdsOAuthService.name);

  constructor(
    @InjectRepository(SocialAdAccountConnectionEntity, 'agency')
    private readonly connectionsRepository: Repository<SocialAdAccountConnectionEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly api: TikTokAdsApiClient,
    private readonly cryptoService: SettingsCryptoService,
    private readonly backfillPlanner: SocialAdBackfillPlannerService,
    @Optional()
    private readonly clientAreaSettings?: ClientAreaSettingsRegistry,
  ) {}

  async start(input: StartTikTokAdsConnectionInput) {
    const { appId } = readTikTokAdsAppConfig();
    const callbackUrl = requireTikTokAdsCallbackUrl();
    requireSocialFrontendUrl();

    await this.connectionsRepository.delete({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      provider: PROVIDER,
      externalAccountId: IsNull(),
      agencyClientId: input.agencyClientId ?? IsNull(),
      companyContextId: input.companyContextId ?? IsNull(),
    });

    const state = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const connection = this.connectionsRepository.create({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agencyClientId: input.agencyClientId,
      companyContextId: input.companyContextId ?? null,
      provider: PROVIDER,
      authorizationMethod: 'tiktok_business',
      externalAccountId: null,
      connectionStatus: 'pending',
      credentialVersion: 1,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      scopes: [...SCOPES],
      oauthStateHash: hashOAuthState(state),
      oauthExpiresAt: expiresAt,
      createdById: input.userId,
      metadata: {
        startedAt: new Date().toISOString(),
        ...(input.clientAreaBinding
          ? { clientAreaBinding: input.clientAreaBinding }
          : {}),
      },
    });

    await this.connectionsRepository.save(connection);

    return {
      connectionId: connection.id,
      authorizationUrl: buildTikTokAuthorizationUrl({
        appId,
        callbackUrl,
        state,
      }).toString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async handleCallback(input: TikTokAdsCallbackInput) {
    const navigation =
      this.clientAreaSettings &&
      typeof input.state === 'string' &&
      input.state.length <= 512
        ? await this.connectionsRepository
            .findOne({
              where: { oauthStateHash: hashOAuthState(input.state) },
              select: { metadata: true },
            })
            .catch(() => null)
        : null;
    let outcome: CallbackOutcome;

    try {
      outcome = await this.complete(input);
    } catch (error) {
      this.logger.warn(
        `TikTok Ads OAuth callback failed: ${
          error instanceof Error ? error.name : 'unknown_error'
        }`,
      );
      outcome = { ok: false, reason: 'callback_failed' };
    }

    return clientAreaOAuthRedirect(
      this.buildFrontendRedirect(outcome),
      navigation?.metadata,
    );
  }

  async select(input: SelectTikTokAdsAccountInput) {
    const agencyClientId = input.agencyClientId ?? null;
    const companyContextId = input.companyContextId ?? null;
    const result = await this.dataSource.transaction(async (manager) => {
      const connections = manager.getRepository(
        SocialAdAccountConnectionEntity,
      );

      const pending = await connections
        .createQueryBuilder('connection')
        .addSelect('connection.accessTokenEncrypted')
        .where('connection.id = :id', { id: input.connectionId })
        .andWhere('connection.tenantId = :tenantId', {
          tenantId: input.tenantId,
        })
        .andWhere('connection.workspaceId = :workspaceId', {
          workspaceId: input.workspaceId,
        })
        .andWhere('connection.provider = :provider', { provider: PROVIDER })
        .andWhere(
          'connection.agencyClientId IS NOT DISTINCT FROM :agencyClientId',
          { agencyClientId },
        )
        .andWhere(
          'connection.companyContextId IS NOT DISTINCT FROM :companyContextId',
          { companyContextId },
        )
        .setLock('pessimistic_write')
        .getOne();

      if (!pending) {
        return { ok: false as const, code: 'invalid_connection' as const };
      }

      if (
        pending.metadata?.clientAreaBinding &&
        (pending.metadata.clientAreaBinding as ClientAreaOAuthBinding)
          .sessionId !== input.clientAreaSessionId
      ) {
        throw new BadRequestException('invalid_connection');
      }
      await this.assertClientBinding(pending);

      if (pending.connectionStatus !== 'awaiting_selection') {
        return { ok: false as const, code: 'connection_consumed' as const };
      }

      if (
        pending.oauthExpiresAt &&
        pending.oauthExpiresAt.getTime() <= Date.now()
      ) {
        return { ok: false as const, code: 'connection_expired' as const };
      }

      if (pending.createdById && pending.createdById !== input.userId) {
        return { ok: false as const, code: 'invalid_connection' as const };
      }

      const account = readAccountOptions(pending.metadata).find(
        (option) => option.externalAccountId === input.externalAccountId,
      );

      if (!account) {
        return { ok: false as const, code: 'account_not_available' as const };
      }

      const encryptedToken = pending.accessTokenEncrypted;

      if (!encryptedToken) {
        return {
          ok: false as const,
          code: 'credential_decryption_failed' as const,
        };
      }

      const existing = await connections
        .createQueryBuilder('connection')
        .where('connection.tenantId = :tenantId', {
          tenantId: input.tenantId,
        })
        .andWhere('connection.workspaceId = :workspaceId', {
          workspaceId: input.workspaceId,
        })
        .andWhere('connection.provider = :provider', { provider: PROVIDER })
        .andWhere('connection.externalAccountId = :externalAccountId', {
          externalAccountId: input.externalAccountId,
        })
        .andWhere(
          'connection.agencyClientId IS NOT DISTINCT FROM :agencyClientId',
          { agencyClientId },
        )
        .andWhere(
          'connection.companyContextId IS NOT DISTINCT FROM :companyContextId',
          { companyContextId },
        )
        .setLock('pessimistic_write')
        .getOne();

      if (existing && !existing.credentialRemovedAt) {
        return {
          ok: false as const,
          code: 'account_already_connected' as const,
        };
      }

      const target = existing ?? pending;

      target.agencyClientId = pending.agencyClientId;
      target.companyContextId = pending.companyContextId;
      target.authorizationMethod = 'tiktok_business';
      target.externalAccountId = account.externalAccountId;
      target.accountName = account.accountName;
      target.currency = account.currency;
      // The advertiser's own zone (validated IANA) or null: the resolver then
      // refuses to sync instead of guessing a day boundary.
      target.timezone = account.timezone;
      target.connectionStatus = 'connected';
      target.accessTokenEncrypted = encryptedToken;
      target.refreshTokenEncrypted = null;
      target.tokenExpiresAt = pending.tokenExpiresAt;
      target.scopes = [...SCOPES];
      target.credentialVersion = existing
        ? existing.credentialVersion + 1
        : pending.credentialVersion;
      target.credentialRemovedAt = null;
      target.lastSyncError = null;
      target.oauthStateHash = null;
      target.oauthExpiresAt = null;
      target.createdById = pending.createdById;
      target.metadata = {
        connectedAt: new Date().toISOString(),
        accountStatus: account.accountStatus,
      };

      await connections.save(target);

      if (existing && existing.id !== pending.id) {
        await connections.delete({ id: pending.id });
      }

      return { ok: true as const, connection: target };
    });

    if (!result.ok) {
      throw new BadRequestException(result.code satisfies SelectionErrorCode);
    }

    await this.backfillPlanner.planForConnectedAccount(result.connection);

    return toSocialAdConnectionView(result.connection);
  }

  private async assertClientBinding(
    connection: SocialAdAccountConnectionEntity,
  ) {
    if (!connection.metadata?.clientAreaBinding) return;
    if (!this.clientAreaSettings) {
      throw new BadRequestException('Client Area OAuth is unavailable.');
    }
    await this.clientAreaSettings.assertOAuthBinding(
      connection.metadata.clientAreaBinding,
      {
        tenantId: connection.tenantId,
        workspaceId: connection.workspaceId,
        agencyClientId: connection.agencyClientId,
        companyContextId: connection.companyContextId,
        userId: connection.createdById,
      },
    );
  }

  private async complete(
    input: TikTokAdsCallbackInput,
  ): Promise<CallbackOutcome> {
    if (!isAcceptableOAuthState(input.state)) {
      return { ok: false, reason: 'invalid_state' };
    }

    const stateHash = hashOAuthState(input.state);

    return this.dataSource.transaction(async (manager) => {
      const connections = manager.getRepository(
        SocialAdAccountConnectionEntity,
      );

      const connection = await connections
        .createQueryBuilder('connection')
        .where('connection.oauthStateHash = :stateHash', { stateHash })
        .andWhere('connection.provider = :provider', { provider: PROVIDER })
        .setLock('pessimistic_write')
        .getOne();

      if (!connection) return { ok: false, reason: 'invalid_state' };

      await this.assertClientBinding(connection);

      if (connection.connectionStatus !== 'pending') {
        return { ok: false, reason: 'connection_consumed' };
      }

      if (
        connection.oauthExpiresAt &&
        connection.oauthExpiresAt.getTime() <= Date.now()
      ) {
        await this.failConnection(connections, connection, 'session_expired');
        return { ok: false, reason: 'session_expired' };
      }

      if (input.error) {
        await this.failConnection(connections, connection, 'oauth_denied');
        return { ok: false, reason: 'oauth_denied' };
      }

      if (!input.authCode) {
        await this.failConnection(connections, connection, 'missing_code');
        return { ok: false, reason: 'missing_code' };
      }

      let grant: Awaited<ReturnType<TikTokAdsApiClient['exchangeCode']>>;

      try {
        grant = await this.api.exchangeCode(input.authCode);
      } catch {
        await this.failConnection(
          connections,
          connection,
          'token_exchange_failed',
        );
        return { ok: false, reason: 'token_exchange_failed' };
      }

      let accounts: Awaited<ReturnType<TikTokAdsApiClient['listAdvertisers']>>;

      try {
        accounts = await this.api.listAdvertisers(
          grant.accessToken,
          grant.advertiserIds,
        );
      } catch {
        await this.failConnection(
          connections,
          connection,
          'account_discovery_failed',
        );
        return { ok: false, reason: 'account_discovery_failed' };
      }

      if (accounts.length === 0) {
        await this.failConnection(
          connections,
          connection,
          'no_accounts_available',
        );
        return { ok: false, reason: 'no_accounts_available' };
      }

      const encrypted = this.cryptoService.encrypt(grant.accessToken);

      if (!encrypted) {
        await this.failConnection(
          connections,
          connection,
          'credential_encryption_failed',
        );
        return { ok: false, reason: 'credential_encryption_failed' };
      }

      connection.connectionStatus = 'awaiting_selection';
      connection.accessTokenEncrypted = encrypted;
      connection.tokenExpiresAt = grant.expiresIn
        ? new Date(Date.now() + grant.expiresIn * 1000)
        : null;
      connection.lastSyncError = null;
      connection.oauthStateHash = null;
      connection.metadata = {
        ...(connection.metadata ?? {}),
        discoveredAt: new Date().toISOString(),
        selectableAccounts: accounts.map((account) => ({
          externalAccountId: account.externalAccountId,
          accountName: account.accountName,
          currency: account.currency,
          timezone: account.timezone,
          accountStatus: account.accountStatus,
        })),
      };

      await connections.save(connection);

      return { ok: true, connectionId: connection.id };
    });
  }

  private async failConnection(
    connections: Repository<SocialAdAccountConnectionEntity>,
    connection: SocialAdAccountConnectionEntity,
    safeErrorCode: string,
  ) {
    connection.connectionStatus = 'error';
    connection.lastSyncError = safeErrorCode;
    connection.oauthStateHash = null;
    connection.accessTokenEncrypted = null;
    connection.refreshTokenEncrypted = null;
    connection.metadata = {
      ...(connection.metadata ?? {}),
      failedAt: new Date().toISOString(),
      failedStep: safeErrorCode,
    };

    await connections.save(connection);
  }

  private buildFrontendRedirect(outcome: CallbackOutcome) {
    const redirect = new URL(CHANNEL_PATH, requireSocialFrontendUrl());
    redirect.searchParams.set('integration', 'tiktok-ads');

    if (outcome.ok) {
      redirect.searchParams.set('status', 'select_account');
      redirect.searchParams.set('connection', outcome.connectionId);
    } else {
      redirect.searchParams.set('status', 'error');
      redirect.searchParams.set('reason', outcome.reason);
    }

    return redirect.toString();
  }
}
