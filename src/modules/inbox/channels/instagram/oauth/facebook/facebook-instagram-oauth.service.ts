import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../../../../common/crypto/settings-crypto.service';
import { InboxChannelConnectionSessionEntity } from '../../../../entities/inbox-channel-connection-session.entity';
import { MetaAssetDiscoveryService } from '../../../meta/services/meta-asset-discovery.service';
import { MetaGraphService } from '../../../meta/services/meta-graph.service';

const SESSION_TTL_MS = 15 * 60 * 1000;
const OAUTH_STARTED_STAGE = 'oauth_started';
const ASSET_SELECTION_STAGE = 'asset_selection';

type StartFacebookInstagramOAuthInput = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
  metadata?: Record<string, unknown>;
};

type FacebookInstagramOAuthCallbackInput = {
  code?: string;
  state?: string;
  error?: string;
  errorReason?: string;
  errorDescription?: string;
};

type CallbackOutcome =
  | { ok: true; sessionId: string }
  | { ok: false; reason: string };

type EncryptedFacebookCredentials = {
  userAccessToken: string;
  pageCredentials: Array<{
    pageId: string;
    pageAccessToken: string;
  }>;
};

@Injectable()
export class FacebookInstagramOAuthService {
  constructor(
    @InjectRepository(InboxChannelConnectionSessionEntity, 'agency')
    private readonly sessionsRepository: Repository<InboxChannelConnectionSessionEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly metaGraphService: MetaGraphService,
    private readonly assetDiscoveryService: MetaAssetDiscoveryService,
    private readonly cryptoService: SettingsCryptoService,
  ) {}

  async start(input: StartFacebookInstagramOAuthInput) {
    const callbackUrl = this.requireConfiguredUrl(
      'META_FACEBOOK_OAUTH_CALLBACK_URL',
    );
    this.requireFrontendUrl();
    const loginConfig = this.metaGraphService.getFacebookLoginConfig();
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
        authorizationMethod: 'facebook_login',
        stage: OAUTH_STARTED_STAGE,
        stateStorage: 'sha256',
        permissionSource: 'meta_dashboard_config',
        startedAt: new Date().toISOString(),
      },
      expiresAt,
      completedAt: null,
    });

    await this.sessionsRepository.save(session);

    const authorizationUrl = new URL(loginConfig.authorizationEndpoint);
    authorizationUrl.searchParams.set('client_id', loginConfig.appId);
    authorizationUrl.searchParams.set('redirect_uri', callbackUrl.toString());
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('override_default_response_type', 'true');
    authorizationUrl.searchParams.set('config_id', loginConfig.configId);
    authorizationUrl.searchParams.set('state', state);

    return {
      authorizationUrl: authorizationUrl.toString(),
      expiresAt,
    };
  }

  async handleCallback(input: FacebookInstagramOAuthCallbackInput) {
    let outcome: CallbackOutcome;

    try {
      outcome = await this.complete(input);
    } catch {
      outcome = { ok: false, reason: 'session_persistence_failed' };
    }

    return this.buildFrontendRedirect(outcome);
  }

  private async complete(
    input: FacebookInstagramOAuthCallbackInput,
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

      if (
        session.status !== 'pending' ||
        session.metadata?.authorizationMethod !== 'facebook_login' ||
        session.metadata?.stage !== OAUTH_STARTED_STAGE
      ) {
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
        'META_FACEBOOK_OAUTH_CALLBACK_URL',
      ).toString();

      let token: Awaited<
        ReturnType<MetaGraphService['exchangeFacebookOAuthCode']>
      >;
      try {
        token = await this.metaGraphService.exchangeFacebookOAuthCode({
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

      let assets: Awaited<
        ReturnType<MetaAssetDiscoveryService['discoverFacebookPageAssets']>
      >;
      try {
        assets = await this.assetDiscoveryService.discoverFacebookPageAssets(
          token.accessToken,
        );
      } catch {
        await this.finishSessionWithError(
          sessions,
          session,
          'failed',
          'asset_discovery_failed',
        );
        return { ok: false, reason: 'asset_discovery_failed' };
      }

      if (assets.length === 0) {
        await this.finishSessionWithError(
          sessions,
          session,
          'failed',
          'no_assets_available',
        );
        return { ok: false, reason: 'no_assets_available' };
      }

      const selectableAssets = assets.map((asset) => ({
        pageId: asset.pageId,
        pageName: asset.pageName,
        instagramAccountId: asset.instagramAccount?.accountId ?? null,
        instagramUsername: asset.instagramAccount?.username ?? null,
      }));
      const credentials: EncryptedFacebookCredentials = {
        userAccessToken: token.accessToken,
        pageCredentials: assets.map((asset) => ({
          pageId: asset.pageId,
          pageAccessToken: asset.pageAccessToken,
        })),
      };

      try {
        const credentialsEncrypted = this.cryptoService.encrypt(
          JSON.stringify(credentials),
        );
        if (!credentialsEncrypted) {
          throw new BadRequestException(
            'Facebook credential encryption failed.',
          );
        }

        session.payload = {
          credentialsEncrypted,
          selectableAssets,
        };
        session.metadata = {
          ...(session.metadata ?? {}),
          stage: ASSET_SELECTION_STAGE,
          discoveredAt: new Date().toISOString(),
          selectableAssetCount: selectableAssets.length,
          instagramAssetCount: selectableAssets.filter(
            (asset) => asset.instagramAccountId !== null,
          ).length,
        };
        session.status = 'pending';
        session.completedAt = null;
        session.errorMessage = null;
        session.code = null;
        await sessions.save(session);
      } catch {
        try {
          await this.finishSessionWithError(
            sessions,
            session,
            'failed',
            'session_persistence_failed',
          );
        } catch {
          // The transaction will roll back; the redirect still exposes only a safe code.
        }
        return { ok: false, reason: 'session_persistence_failed' };
      }

      return { ok: true, sessionId: session.id };
    });
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
    session.code = null;
    await sessions.save(session);
  }

  private buildFrontendRedirect(outcome: CallbackOutcome) {
    const redirect = new URL(
      '/leadflow/inbox/settings/oauth/instagram',
      this.requireFrontendUrl(),
    );

    if (outcome.ok) {
      redirect.searchParams.set('status', 'select_asset');
      redirect.searchParams.set('session', outcome.sessionId);
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

  private hashState(state: string) {
    return createHash('sha256').update(state).digest('hex');
  }
}
