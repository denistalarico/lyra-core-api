import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../../../../common/crypto/settings-crypto.service';
import { InboxChannelConnectionSessionEntity } from '../../../../entities/inbox-channel-connection-session.entity';
import { MetaAssetDiscoveryService } from '../../../meta/services/meta-asset-discovery.service';
import {
  INSTAGRAM_MESSAGING_WEBHOOK_FIELDS,
  MetaGraphService,
} from '../../../meta/services/meta-graph.service';
import { InstagramChannelConnectionService } from '../instagram-channel-connection.service';

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

type SelectFacebookInstagramAssetInput = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
  sessionId: string;
  pageId: string;
};

type SelectableFacebookAsset = {
  pageId: string;
  pageName: string;
  instagramAccountId: string | null;
  instagramUsername: string | null;
};

type SelectionErrorCode =
  | 'invalid_session'
  | 'session_expired'
  | 'session_consumed'
  | 'asset_not_available'
  | 'credential_decryption_failed'
  | 'invalid_credential_payload'
  | 'asset_revalidation_failed'
  | 'selected_page_has_no_instagram'
  | 'instagram_asset_changed'
  | 'webhook_subscription_failed';

type SelectionResult =
  | { ok: true; channelId: string }
  | { ok: false; code: SelectionErrorCode };

@Injectable()
export class FacebookInstagramOAuthService {
  constructor(
    @InjectRepository(InboxChannelConnectionSessionEntity, 'agency')
    private readonly sessionsRepository: Repository<InboxChannelConnectionSessionEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly metaGraphService: MetaGraphService,
    private readonly assetDiscoveryService: MetaAssetDiscoveryService,
    private readonly cryptoService: SettingsCryptoService,
    private readonly channelConnectionService: InstagramChannelConnectionService,
  ) {}

  async select(input: SelectFacebookInstagramAssetInput) {
    let result: SelectionResult;
    try {
      result = await this.dataSource.transaction(async (manager) => {
        const sessions = manager.getRepository(
          InboxChannelConnectionSessionEntity,
        );
        const session = await sessions.findOne({
          where: {
            id: input.sessionId,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            provider: 'meta',
            channelType: 'instagram',
          },
          lock: { mode: 'pessimistic_write' },
        });

        if (!session) {
          return { ok: false, code: 'invalid_session' };
        }
        if (session.status === 'expired') {
          return { ok: false, code: 'session_expired' };
        }
        if (session.status !== 'pending') {
          return { ok: false, code: 'session_consumed' };
        }
        if (session.expiresAt.getTime() <= Date.now()) {
          session.status = 'expired';
          session.errorMessage = 'session_expired';
          await sessions.save(session);
          return { ok: false, code: 'session_expired' };
        }
        if (
          session.metadata?.authorizationMethod !== 'facebook_login' ||
          session.metadata?.stage !== ASSET_SELECTION_STAGE
        ) {
          return { ok: false, code: 'invalid_session' };
        }
        if (session.userId !== null && session.userId !== input.userId) {
          return { ok: false, code: 'invalid_session' };
        }

        const payload = this.isRecord(session.payload) ? session.payload : {};
        const selectedAsset = this.findSelectableAsset(
          payload.selectableAssets,
          input.pageId,
        );
        if (!selectedAsset) {
          return { ok: false, code: 'asset_not_available' };
        }

        const credentialsEncrypted = payload.credentialsEncrypted;
        if (typeof credentialsEncrypted !== 'string' || !credentialsEncrypted) {
          return { ok: false, code: 'invalid_credential_payload' };
        }

        let decrypted: string | null;
        try {
          decrypted = this.cryptoService.decrypt(credentialsEncrypted);
        } catch {
          return { ok: false, code: 'credential_decryption_failed' };
        }
        if (!decrypted) {
          return { ok: false, code: 'credential_decryption_failed' };
        }

        const credentials = this.parseEncryptedCredentials(decrypted);
        if (!credentials) {
          return { ok: false, code: 'invalid_credential_payload' };
        }
        const pageCredential = credentials.pageCredentials.find(
          (credential) => credential.pageId === input.pageId,
        );
        if (!pageCredential) {
          return { ok: false, code: 'invalid_credential_payload' };
        }

        let currentAccount: Awaited<
          ReturnType<MetaGraphService['getFacebookPageInstagramAccount']>
        >;
        try {
          currentAccount =
            await this.metaGraphService.getFacebookPageInstagramAccount({
              pageId: input.pageId,
              pageAccessToken: pageCredential.pageAccessToken,
            });
        } catch {
          return { ok: false, code: 'asset_revalidation_failed' };
        }
        if (!currentAccount) {
          return { ok: false, code: 'selected_page_has_no_instagram' };
        }
        if (currentAccount.accountId !== selectedAsset.instagramAccountId) {
          return { ok: false, code: 'instagram_asset_changed' };
        }

        try {
          await this.metaGraphService.subscribeFacebookPageToInstagramWebhooks({
            pageId: input.pageId,
            pageAccessToken: pageCredential.pageAccessToken,
            subscribedFields: INSTAGRAM_MESSAGING_WEBHOOK_FIELDS,
          });
        } catch {
          return { ok: false, code: 'webhook_subscription_failed' };
        }

        const channel = await this.channelConnectionService.connect(manager, {
          session,
          accountId: currentAccount.accountId,
          scopedId: null,
          username: currentAccount.username,
          accessToken: pageCredential.pageAccessToken,
          tokenType: 'page_access_token',
          tokenExpiresIn: null,
          permissions: [],
          authorizationMethod: 'facebook_login',
          facebookPageId: input.pageId,
        });

        session.status = 'completed';
        session.completedAt = new Date();
        session.errorMessage = null;
        const completedPayload = { ...payload };
        delete completedPayload.credentialsEncrypted;
        session.payload = completedPayload;
        session.metadata = {
          ...(session.metadata ?? {}),
          stage: 'completed',
          channelId: channel.id,
          completedAt: session.completedAt.toISOString(),
          selectedPageId: input.pageId,
          selectedInstagramAccountId: currentAccount.accountId,
        };
        await sessions.save(session);

        return { ok: true, channelId: channel.id };
      });
    } catch {
      throw new BadRequestException('channel_persistence_failed');
    }

    if (!result.ok) {
      throw new BadRequestException(result.code);
    }
    return { channelId: result.channelId };
  }

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

  private findSelectableAsset(
    value: unknown,
    pageId: string,
  ): SelectableFacebookAsset | null {
    if (!Array.isArray(value)) return null;
    for (const candidate of value as unknown[]) {
      if (!this.isRecord(candidate) || candidate.pageId !== pageId) continue;
      if (
        typeof candidate.pageName !== 'string' ||
        (candidate.instagramAccountId !== null &&
          typeof candidate.instagramAccountId !== 'string') ||
        (candidate.instagramUsername !== null &&
          typeof candidate.instagramUsername !== 'string')
      ) {
        return null;
      }

      return {
        pageId,
        pageName: candidate.pageName,
        instagramAccountId: candidate.instagramAccountId,
        instagramUsername: candidate.instagramUsername,
      };
    }
    return null;
  }

  private parseEncryptedCredentials(
    value: string,
  ): EncryptedFacebookCredentials | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
    if (
      !this.isRecord(parsed) ||
      !this.isNonEmptyString(parsed.userAccessToken) ||
      !Array.isArray(parsed.pageCredentials)
    ) {
      return null;
    }

    const pageCredentials: EncryptedFacebookCredentials['pageCredentials'] = [];
    const pageIds = new Set<string>();
    for (const candidate of parsed.pageCredentials) {
      if (
        !this.isRecord(candidate) ||
        !this.isNonEmptyString(candidate.pageId) ||
        !this.isNonEmptyString(candidate.pageAccessToken) ||
        pageIds.has(candidate.pageId)
      ) {
        return null;
      }
      pageIds.add(candidate.pageId);
      pageCredentials.push({
        pageId: candidate.pageId,
        pageAccessToken: candidate.pageAccessToken,
      });
    }

    return {
      userAccessToken: parsed.userAccessToken,
      pageCredentials,
    };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
