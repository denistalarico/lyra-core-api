import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { InboxChannelConnectionSessionEntity } from '../../../entities/inbox-channel-connection-session.entity';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { MetaGraphService } from '../../meta/services/meta-graph.service';

const INSTAGRAM_OAUTH_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
] as const;
const SESSION_TTL_MS = 15 * 60 * 1000;

type StartInstagramOAuthInput = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
  metadata?: Record<string, unknown>;
};

type InstagramOAuthCallbackInput = {
  code?: string;
  state?: string;
  error?: string;
  errorReason?: string;
  errorDescription?: string;
};

type CallbackOutcome =
  | { ok: true; channelId: string }
  | { ok: false; reason: string };

@Injectable()
export class InstagramOAuthService {
  constructor(
    @InjectRepository(InboxChannelConnectionSessionEntity, 'agency')
    private readonly sessionsRepository: Repository<InboxChannelConnectionSessionEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly metaGraphService: MetaGraphService,
    private readonly cryptoService: SettingsCryptoService,
  ) {}

  async start(input: StartInstagramOAuthInput) {
    const callbackUrl = this.requireConfiguredUrl(
      'META_INSTAGRAM_OAUTH_CALLBACK_URL',
    );
    this.requireFrontendUrl();
    const { appId } = this.metaGraphService.getInstagramLoginConfig();

    const state = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const session = this.sessionsRepository.create({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      provider: 'meta',
      channelType: 'instagram',
      status: 'pending',
      state: this.hashState(state),
      code: null,
      payload: {},
      metadata: {
        ...(input.metadata ?? {}),
        authorizationMethod: 'instagram_login',
        stateStorage: 'sha256',
        requestedScopes: [...INSTAGRAM_OAUTH_SCOPES],
        startedAt: new Date().toISOString(),
      },
      expiresAt,
      completedAt: null,
    });

    await this.sessionsRepository.save(session);

    const authorizationUrl = new URL(
      'https://www.instagram.com/oauth/authorize',
    );
    authorizationUrl.searchParams.set('client_id', appId);
    authorizationUrl.searchParams.set('redirect_uri', callbackUrl.toString());
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set(
      'scope',
      INSTAGRAM_OAUTH_SCOPES.join(','),
    );
    authorizationUrl.searchParams.set('state', state);

    return {
      authorizationUrl: authorizationUrl.toString(),
      expiresAt,
    };
  }

  async handleCallback(input: InstagramOAuthCallbackInput) {
    let outcome: CallbackOutcome;

    try {
      outcome = await this.complete(input);
    } catch {
      outcome = { ok: false, reason: 'connection_failed' };
    }

    return this.buildFrontendRedirect(outcome);
  }

  private async complete(
    input: InstagramOAuthCallbackInput,
  ): Promise<CallbackOutcome> {
    if (!input.state || input.state.length > 512) {
      return { ok: false, reason: 'invalid_state' };
    }

    const stateHash = this.hashState(input.state);

    return this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(
        InboxChannelConnectionSessionEntity,
      );
      const session = await sessions.findOne({
        where: {
          state: stateHash,
          provider: 'meta',
          channelType: 'instagram',
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!session) {
        return { ok: false, reason: 'invalid_state' };
      }

      if (session.status !== 'pending') {
        return { ok: false, reason: 'session_consumed' };
      }

      if (session.expiresAt.getTime() <= Date.now()) {
        await this.finishSessionWithError(
          sessions,
          session,
          'expired',
          'session_expired',
        );
        return { ok: false, reason: 'session_expired' };
      }

      if (input.error || input.errorReason || input.errorDescription) {
        await this.finishSessionWithError(
          sessions,
          session,
          'failed',
          'oauth_denied',
        );
        return { ok: false, reason: 'oauth_denied' };
      }

      if (!input.code) {
        await this.finishSessionWithError(
          sessions,
          session,
          'failed',
          'missing_code',
        );
        return { ok: false, reason: 'missing_code' };
      }

      const redirectUri = this.requireConfiguredUrl(
        'META_INSTAGRAM_OAUTH_CALLBACK_URL',
      ).toString();

      let shortLived: Awaited<
        ReturnType<MetaGraphService['exchangeInstagramCode']>
      >;
      try {
        shortLived = await this.metaGraphService.exchangeInstagramCode({
          code: input.code,
          redirectUri,
        });
      } catch {
        await this.finishSessionWithError(
          sessions,
          session,
          'failed',
          'token_exchange_failed',
        );
        return { ok: false, reason: 'token_exchange_failed' };
      }

      let longLived: Awaited<
        ReturnType<MetaGraphService['exchangeInstagramLongLivedToken']>
      >;
      try {
        longLived = await this.metaGraphService.exchangeInstagramLongLivedToken(
          shortLived.accessToken,
        );
      } catch {
        await this.finishSessionWithError(
          sessions,
          session,
          'failed',
          'long_lived_token_exchange_failed',
        );
        return {
          ok: false,
          reason: 'long_lived_token_exchange_failed',
        };
      }

      let identity: Awaited<
        ReturnType<MetaGraphService['getInstagramAuthorizedAccount']>
      >;
      try {
        identity = await this.metaGraphService.getInstagramAuthorizedAccount(
          longLived.accessToken,
        );
      } catch {
        await this.finishSessionWithError(
          sessions,
          session,
          'failed',
          'identity_lookup_failed',
        );
        return { ok: false, reason: 'identity_lookup_failed' };
      }

      let channel: InboxChannelEntity;
      try {
        await this.lockInstagramAccount(manager, session, identity.accountId);
        channel = await this.upsertChannel(manager, {
          session,
          accountId: identity.accountId,
          username: identity.username,
          accessToken: longLived.accessToken,
          tokenType: longLived.tokenType,
          tokenExpiresIn: longLived.expiresIn,
          permissions: shortLived.permissions,
        });
      } catch {
        await this.finishSessionWithError(
          sessions,
          session,
          'failed',
          'channel_persistence_failed',
        );
        return { ok: false, reason: 'channel_persistence_failed' };
      }

      session.status = 'completed';
      session.completedAt = new Date();
      session.errorMessage = null;
      session.metadata = {
        ...(session.metadata ?? {}),
        completedAt: session.completedAt.toISOString(),
        channelId: channel.id,
        externalAccountId: identity.accountId,
        username: identity.username,
      };
      await sessions.save(session);

      return { ok: true, channelId: channel.id };
    });
  }

  private async upsertChannel(
    manager: EntityManager,
    input: {
      session: InboxChannelConnectionSessionEntity;
      accountId: string;
      username: string | null;
      accessToken: string;
      tokenType: string | null;
      tokenExpiresIn: number | null;
      permissions: string[];
    },
  ) {
    const channels = manager.getRepository(InboxChannelEntity);
    const existing = await channels.findOne({
      where: {
        tenantId: input.session.tenantId,
        workspaceId: input.session.workspaceId,
        type: 'instagram',
        provider: 'meta',
        externalAccountId: input.accountId,
        deletedAt: IsNull(),
      },
      lock: { mode: 'pessimistic_write' },
    });
    const wasDisconnected = Boolean(
      existing &&
      (existing.status !== 'active' ||
        existing.connectionStatus !== 'connected' ||
        existing.disconnectedAt ||
        existing.credentialRemovedAt),
    );
    const connectedAt = new Date();
    const expiresAt = this.tokenExpiresAt(connectedAt, input.tokenExpiresIn);
    const encryptedToken = this.cryptoService.encrypt(input.accessToken);

    if (!encryptedToken) {
      throw new BadRequestException('Instagram credential encryption failed.');
    }

    const channel =
      existing ??
      channels.create({
        tenantId: input.session.tenantId,
        workspaceId: input.session.workspaceId,
        name: input.username ?? `Instagram ${input.accountId}`,
        type: 'instagram',
        provider: 'meta',
        status: 'active',
        connectionStatus: 'connected',
        lifecycleVersion: 1,
        credentialVersion: 0,
        aiEnabled: false,
        settings: {},
        metadata: {},
      });

    channel.type = 'instagram';
    channel.provider = 'meta';
    channel.externalAccountId = input.accountId;
    channel.status = 'active';
    channel.connectionStatus = 'connected';
    channel.accessTokenEncrypted = encryptedToken;
    channel.credentialVersion = (existing?.credentialVersion ?? 0) + 1;
    channel.lifecycleVersion = existing
      ? (existing.lifecycleVersion || 1) + (wasDisconnected ? 1 : 0)
      : 1;
    channel.suspendedAt = null;
    channel.disconnectedAt = null;
    channel.disconnectedBy = null;
    channel.disconnectReason = null;
    channel.credentialRemovedAt = null;
    channel.settings = {
      ...(existing?.settings ?? {}),
      connectionHealth: 'ok',
    };
    channel.metadata = {
      ...(existing?.metadata ?? {}),
      authorizationMethod: 'instagram_login',
      username: input.username,
      connectionSessionId: input.session.id,
      connectedAt: connectedAt.toISOString(),
      tokenType: input.tokenType,
      tokenExpiresAt: expiresAt?.toISOString() ?? null,
      grantedPermissions: input.permissions,
    };

    return channels.save(channel);
  }

  private async lockInstagramAccount(
    manager: EntityManager,
    session: InboxChannelConnectionSessionEntity,
    accountId: string,
  ) {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [
        `${session.tenantId}:${session.workspaceId}`,
        `instagram:meta:${accountId}`,
      ],
    );
  }

  private async finishSessionWithError(
    sessions: Repository<InboxChannelConnectionSessionEntity>,
    session: InboxChannelConnectionSessionEntity,
    status: 'failed' | 'expired',
    safeErrorCode: string,
  ) {
    session.status = status;
    session.errorMessage = safeErrorCode;
    session.metadata = {
      ...(session.metadata ?? {}),
      failedAt: new Date().toISOString(),
      failedStep: safeErrorCode,
    };
    await sessions.save(session);
  }

  private buildFrontendRedirect(outcome: CallbackOutcome) {
    const redirect = new URL(
      '/leadflow/inbox/settings/oauth/instagram',
      this.requireFrontendUrl(),
    );

    if (outcome.ok) {
      redirect.searchParams.set('status', 'connected');
    } else {
      redirect.searchParams.set('status', 'error');
      redirect.searchParams.set('reason', outcome.reason);
    }

    return redirect.toString();
  }

  private requireFrontendUrl() {
    const value =
      process.env.LEADFLOW_FRONTEND_URL ?? process.env.APP_FRONTEND_URL;
    if (!value) {
      throw new BadRequestException('LeadFlow frontend URL is not configured.');
    }

    return this.parseHttpUrl(value, 'LeadFlow frontend URL');
  }

  private requireConfiguredUrl(name: string) {
    const value = process.env[name];
    if (!value) {
      throw new BadRequestException(`${name} is not configured.`);
    }

    return this.parseHttpUrl(value, name);
  }

  private parseHttpUrl(value: string, label: string) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException(`${label} must be a valid URL.`);
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new BadRequestException(`${label} must use HTTP or HTTPS.`);
    }

    return url;
  }

  private tokenExpiresAt(startedAt: Date, expiresIn: number | null) {
    if (!expiresIn || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      return null;
    }

    return new Date(startedAt.getTime() + expiresIn * 1000);
  }

  private hashState(state: string) {
    return createHash('sha256').update(state).digest('hex');
  }
}
