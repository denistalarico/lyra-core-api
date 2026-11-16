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
  LinkedInAdsCallbackInput,
  SOCIAL_LINKEDIN_ADS_SCOPES,
  buildLinkedInAuthorizationUrl,
  hashOAuthState,
  isAcceptableOAuthState,
  readLinkedInAdsAppConfig,
  requireLinkedInAdsCallbackUrl,
} from '../oauth/linkedin-ads-oauth.support';
import { requireSocialFrontendUrl } from '../oauth/meta-ads-oauth.support';
import {
  readAccountOptions,
  toSocialAdConnectionView,
} from '../views/social-ad-connection.view';
import { LinkedInAdsApiClient } from './linkedin-ads-api.client';
import { SocialAdBackfillPlannerService } from './social-ad-backfill-planner.service';

const PROVIDER = 'linkedin_ads' as const;
const SESSION_TTL_MS = 15 * 60 * 1000;
const CHANNEL_PATH = '/social/channels/linkedinads';

/**
 * LinkedIn reports `DAILY` rows by calendar date and an ad account has no
 * timezone field, so the stored zone is `UTC` (the same zone LinkedIn states
 * for daily budgets). Recorded as a divergence in the audit doc.
 */
export const LINKEDIN_ADS_ACCOUNT_TIMEZONE = 'UTC';

export type StartLinkedInAdsConnectionInput = {
  clientAreaBinding?: ClientAreaOAuthBinding;
  tenantId: string;
  workspaceId: string;
  userId: string | null;
  agencyClientId?: string | null;
  companyContextId?: string | null;
};

export type SelectLinkedInAdsAccountInput = {
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
 * LinkedIn Ads connection (3-legged OAuth, read-only scopes) and the selection
 * of the ad account to mirror (D-I7). Same lifecycle as the Meta flow:
 * `pending` → `awaiting_selection` → `connected`, with the single-use state
 * hashed at rest and the token encrypted in the row.
 */
@Injectable()
export class LinkedInAdsOAuthService {
  private readonly logger = new Logger(LinkedInAdsOAuthService.name);

  constructor(
    @InjectRepository(SocialAdAccountConnectionEntity, 'agency')
    private readonly connectionsRepository: Repository<SocialAdAccountConnectionEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly api: LinkedInAdsApiClient,
    private readonly cryptoService: SettingsCryptoService,
    private readonly backfillPlanner: SocialAdBackfillPlannerService,
    @Optional()
    private readonly clientAreaSettings?: ClientAreaSettingsRegistry,
  ) {}

  async start(input: StartLinkedInAdsConnectionInput) {
    const { clientId } = readLinkedInAdsAppConfig();
    const callbackUrl = requireLinkedInAdsCallbackUrl();
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
      authorizationMethod: 'linkedin_oauth',
      externalAccountId: null,
      connectionStatus: 'pending',
      credentialVersion: 1,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      scopes: [...SOCIAL_LINKEDIN_ADS_SCOPES],
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
      authorizationUrl: buildLinkedInAuthorizationUrl({
        clientId,
        callbackUrl,
        state,
      }).toString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async handleCallback(input: LinkedInAdsCallbackInput) {
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
        `LinkedIn Ads OAuth callback failed: ${
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

  async select(input: SelectLinkedInAdsAccountInput) {
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
      target.authorizationMethod = 'linkedin_oauth';
      target.externalAccountId = account.externalAccountId;
      target.accountName = account.accountName;
      target.currency = account.currency;
      target.timezone = LINKEDIN_ADS_ACCOUNT_TIMEZONE;
      target.connectionStatus = 'connected';
      target.accessTokenEncrypted = encryptedToken;
      target.refreshTokenEncrypted = null;
      target.tokenExpiresAt = pending.tokenExpiresAt;
      target.scopes = [...SOCIAL_LINKEDIN_ADS_SCOPES];
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
    input: LinkedInAdsCallbackInput,
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

      if (input.error || input.errorDescription) {
        await this.failConnection(connections, connection, 'oauth_denied');
        return { ok: false, reason: 'oauth_denied' };
      }

      if (!input.code) {
        await this.failConnection(connections, connection, 'missing_code');
        return { ok: false, reason: 'missing_code' };
      }

      let grant: Awaited<ReturnType<LinkedInAdsApiClient['exchangeCode']>>;

      try {
        grant = await this.api.exchangeCode({
          code: input.code,
          redirectUri: requireLinkedInAdsCallbackUrl().toString(),
        });
      } catch {
        await this.failConnection(
          connections,
          connection,
          'token_exchange_failed',
        );
        return { ok: false, reason: 'token_exchange_failed' };
      }

      let accounts: Awaited<ReturnType<LinkedInAdsApiClient['listAdAccounts']>>;

      try {
        accounts = await this.api.listAdAccounts(grant.accessToken);
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
          timezone: LINKEDIN_ADS_ACCOUNT_TIMEZONE,
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
    redirect.searchParams.set('integration', 'linkedin-ads');

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
