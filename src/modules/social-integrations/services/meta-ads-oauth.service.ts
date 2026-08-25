import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import {
  MetaAdsCallbackInput,
  SOCIAL_ADS_OAUTH_SESSION_TTL_MS,
  SOCIAL_META_ADS_SCOPES,
  buildFacebookLoginAuthorizationUrl,
  hashOAuthState,
  isAcceptableOAuthState,
  requireSocialFrontendUrl,
  requireSocialMetaAdsCallbackUrl,
} from '../oauth/meta-ads-oauth.support';
import {
  readAccountOptions,
  toSocialAdConnectionView,
} from '../views/social-ad-connection.view';
import { MetaAdsGraphService } from './meta-ads-graph.service';

const PROVIDER = 'meta_ads' as const;

/** Where the browser is sent back to after the provider redirect. */
const SOCIAL_SETTINGS_PATH = '/social/settings';

export type StartMetaAdsConnectionInput = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
  agencyClientId: string | null;
};

export type SelectMetaAdsAccountInput = {
  tenantId: string;
  workspaceId: string;
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
 * Meta Ads authorization for Lyra Social.
 *
 * Runs on its own callback URL and its own row lifecycle. It deliberately does
 * not pass through `FacebookLoginCallbackRouterService`: that router exists to
 * demultiplex the single Inbox redirect URI across messaging channels, and
 * adding a branch to it would make Social's authorization break whenever the
 * Inbox's does.
 *
 * The in-flight session is a `pending` row of the connection table rather than
 * a session table of its own — see the entity for why.
 */
@Injectable()
export class MetaAdsOAuthService {
  private readonly logger = new Logger(MetaAdsOAuthService.name);

  constructor(
    @InjectRepository(SocialAdAccountConnectionEntity, 'agency')
    private readonly connectionsRepository: Repository<SocialAdAccountConnectionEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly graphService: MetaAdsGraphService,
    private readonly cryptoService: SettingsCryptoService,
  ) {}

  async start(input: StartMetaAdsConnectionInput) {
    // Resolve configuration before writing anything: a misconfigured callback
    // should fail the request, not leave an orphan row behind.
    const loginConfig = this.graphService.getLoginConfig();
    const callbackUrl = requireSocialMetaAdsCallbackUrl();
    requireSocialFrontendUrl();

    await this.discardInFlightConnections(input);

    const state = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SOCIAL_ADS_OAUTH_SESSION_TTL_MS);

    const connection = this.connectionsRepository.create({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agencyClientId: input.agencyClientId,
      provider: PROVIDER,
      externalAccountId: null,
      connectionStatus: 'pending',
      credentialVersion: 1,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      scopes: [...SOCIAL_META_ADS_SCOPES],
      oauthStateHash: hashOAuthState(state),
      oauthExpiresAt: expiresAt,
      createdById: input.userId,
      metadata: { startedAt: new Date().toISOString() },
    });

    await this.connectionsRepository.save(connection);

    const authorizationUrl = buildFacebookLoginAuthorizationUrl({
      loginConfig,
      callbackUrl,
      state,
    });

    return {
      connectionId: connection.id,
      authorizationUrl: authorizationUrl.toString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Handles the provider redirect and returns where to send the browser.
   *
   * Never throws: the caller is a public redirect endpoint, and an exception
   * there would render a stack page to whoever hit the URL. Every failure
   * becomes a safe reason code in the query string.
   */
  async handleCallback(input: MetaAdsCallbackInput) {
    let outcome: CallbackOutcome;

    try {
      outcome = await this.complete(input);
    } catch (error) {
      this.logger.warn(
        `Meta Ads OAuth callback failed: ${
          error instanceof Error ? error.name : 'unknown_error'
        }`,
      );
      outcome = { ok: false, reason: 'callback_failed' };
    }

    return this.buildFrontendRedirect(outcome);
  }

  async select(input: SelectMetaAdsAccountInput) {
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
        .setLock('pessimistic_write')
        .getOne();

      if (!pending) {
        return { ok: false as const, code: 'invalid_connection' as const };
      }

      if (pending.connectionStatus !== 'awaiting_selection') {
        return { ok: false as const, code: 'connection_consumed' as const };
      }

      if (
        pending.oauthExpiresAt &&
        pending.oauthExpiresAt.getTime() <= Date.now()
      ) {
        return { ok: false as const, code: 'connection_expired' as const };
      }

      // The authorization belongs to the person who started it. Another admin
      // in the same workspace must run their own OAuth rather than adopt a
      // token issued for someone else's Meta identity.
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

      try {
        if (!this.cryptoService.decrypt(encryptedToken)) {
          return {
            ok: false as const,
            code: 'credential_decryption_failed' as const,
          };
        }
      } catch {
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
        .setLock('pessimistic_write')
        .getOne();

      // An account already live must not be silently re-bound: two rows for
      // one account would each hold a credential, and a later disconnect would
      // only revoke one of them.
      if (existing && !existing.credentialRemovedAt) {
        return {
          ok: false as const,
          code: 'account_already_connected' as const,
        };
      }

      const target = existing ?? pending;

      target.agencyClientId = pending.agencyClientId;
      target.externalAccountId = account.externalAccountId;
      target.externalBusinessId = this.readSelectedBusinessId(
        pending.metadata,
        account.externalAccountId,
      );
      target.accountName = account.accountName;
      target.currency = account.currency;
      target.timezone = account.timezone;
      target.connectionStatus = 'connected';
      target.accessTokenEncrypted = encryptedToken;
      target.refreshTokenEncrypted = null;
      target.tokenExpiresAt = pending.tokenExpiresAt;
      target.scopes = [...SOCIAL_META_ADS_SCOPES];
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
        businessName: account.businessName,
        accountStatus: account.accountStatus,
      };

      await connections.save(target);

      // Reconnecting an account promotes the existing row, so the in-flight
      // one has served its purpose and would otherwise linger as a ghost
      // "connecting" card in the settings screen.
      if (existing && existing.id !== pending.id) {
        await connections.delete({ id: pending.id });
      }

      return { ok: true as const, connection: target };
    });

    if (!result.ok) {
      throw new BadRequestException(result.code satisfies SelectionErrorCode);
    }

    return toSocialAdConnectionView(result.connection);
  }

  private async complete(
    input: MetaAdsCallbackInput,
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

      if (!connection) {
        return { ok: false, reason: 'invalid_state' };
      }

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

      if (input.error || input.errorReason || input.errorDescription) {
        await this.failConnection(connections, connection, 'oauth_denied');
        return { ok: false, reason: 'oauth_denied' };
      }

      if (!input.code) {
        await this.failConnection(connections, connection, 'missing_code');
        return { ok: false, reason: 'missing_code' };
      }

      const redirectUri = requireSocialMetaAdsCallbackUrl().toString();

      let accessToken: string;
      let expiresIn: number | null;

      try {
        const exchanged = await this.graphService.exchangeOAuthCode({
          code: input.code,
          redirectUri,
        });
        accessToken = exchanged.accessToken;
        expiresIn = exchanged.expiresIn;
      } catch {
        await this.failConnection(
          connections,
          connection,
          'token_exchange_failed',
        );
        return { ok: false, reason: 'token_exchange_failed' };
      }

      const longLived = await this.graphService
        .exchangeLongLivedToken(accessToken)
        .catch(() => null);

      if (longLived) {
        accessToken = longLived.accessToken;
        expiresIn = longLived.expiresIn ?? expiresIn;
      }

      let accounts: Awaited<ReturnType<MetaAdsGraphService['listAdAccounts']>>;

      try {
        accounts = await this.graphService.listAdAccounts(accessToken);
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

      const encrypted = this.cryptoService.encrypt(accessToken);

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
      connection.tokenExpiresAt =
        expiresIn && expiresIn > 0
          ? new Date(Date.now() + expiresIn * 1000)
          : null;
      connection.lastSyncError = null;
      // The state is single-use: consuming it here means a replayed callback
      // finds nothing to match.
      connection.oauthStateHash = null;
      connection.metadata = {
        ...(connection.metadata ?? {}),
        discoveredAt: new Date().toISOString(),
        selectableAccounts: accounts.map((account) => ({
          externalAccountId: account.externalAccountId,
          accountName: account.accountName,
          currency: account.currency,
          timezone: account.timezone,
          businessId: account.businessId,
          businessName: account.businessName,
          accountStatus: account.accountStatus,
        })),
      };

      await connections.save(connection);

      return { ok: true, connectionId: connection.id };
    });
  }

  /**
   * Removes leftovers from abandoned attempts before starting a new one.
   *
   * Only rows that never reached an account are touched: `externalAccountId IS
   * NULL` is precisely the set that carries no user-visible connection.
   */
  private async discardInFlightConnections(input: StartMetaAdsConnectionInput) {
    await this.connectionsRepository.delete({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      provider: PROVIDER,
      externalAccountId: IsNull(),
      agencyClientId: input.agencyClientId ?? IsNull(),
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

  private readSelectedBusinessId(
    metadata: Record<string, unknown> | null | undefined,
    externalAccountId: string,
  ): string | null {
    const raw = metadata?.selectableAccounts;

    if (!Array.isArray(raw)) return null;

    for (const candidate of raw) {
      if (typeof candidate !== 'object' || candidate === null) continue;

      const entry = candidate as Record<string, unknown>;

      if (entry.externalAccountId !== externalAccountId) continue;

      return typeof entry.businessId === 'string' && entry.businessId.trim()
        ? entry.businessId.trim()
        : null;
    }

    return null;
  }

  private buildFrontendRedirect(outcome: CallbackOutcome) {
    const redirect = new URL(SOCIAL_SETTINGS_PATH, requireSocialFrontendUrl());
    redirect.searchParams.set('integration', 'meta-ads');

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
