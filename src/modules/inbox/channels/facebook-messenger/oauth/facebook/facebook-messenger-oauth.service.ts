import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../../../../common/crypto/settings-crypto.service';
import { InboxChannelConnectionSessionEntity } from '../../../../entities/inbox-channel-connection-session.entity';
import {
  buildFacebookLoginAuthorizationUrl,
  FACEBOOK_LOGIN_ASSET_SELECTION_STAGE,
  FACEBOOK_LOGIN_OAUTH_STARTED_STAGE,
  FACEBOOK_LOGIN_SESSION_TTL_MS,
  hashFacebookOAuthState,
  isAcceptableFacebookOAuthState,
  isNonEmptyString,
  isRecord,
  requireFacebookLoginCallbackUrl,
  requireLeadFlowFrontendUrl,
  type FacebookLoginCallbackInput,
} from '../../../meta/oauth/facebook-login-oauth.support';
import { MetaAssetDiscoveryService } from '../../../meta/services/meta-asset-discovery.service';
import {
  FACEBOOK_PAGE_MESSENGER_WEBHOOK_FIELDS,
  MetaGraphService,
} from '../../../meta/services/meta-graph.service';
import { FacebookMessengerChannelConnectionService } from '../facebook-messenger-channel-connection.service';

const MESSENGER_SESSION_CHANNEL_TYPE = 'facebook_messenger' as const;

/**
 * Page task required to read and answer Messenger threads. Meta returns it on
 * the `/me/accounts` `tasks` edge; anything else the Page happens to grant
 * (ANALYZE, CREATE_CONTENT, ...) is irrelevant for messaging.
 */
export const MESSENGER_REQUIRED_PAGE_TASK = 'MESSAGING';

type StartFacebookMessengerOAuthInput = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
  metadata?: Record<string, unknown>;
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

type SelectFacebookMessengerPageInput = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
  sessionId: string;
  pageId: string;
};

type GetFacebookMessengerSessionAssetsInput = Omit<
  SelectFacebookMessengerPageInput,
  'pageId'
>;

type SelectableMessengerPage = {
  pageId: string;
  pageName: string;
  tasks: string[];
};

type SelectionErrorCode =
  | 'invalid_session'
  | 'session_expired'
  | 'session_consumed'
  | 'asset_not_available'
  | 'credential_decryption_failed'
  | 'invalid_credential_payload'
  | 'page_missing_messaging_access'
  | 'webhook_subscription_failed';

type SelectionResult =
  | { ok: true; channelId: string }
  | { ok: false; code: SelectionErrorCode };

@Injectable()
export class FacebookMessengerOAuthService {
  constructor(
    @InjectRepository(InboxChannelConnectionSessionEntity, 'agency')
    private readonly sessionsRepository: Repository<InboxChannelConnectionSessionEntity>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly metaGraphService: MetaGraphService,
    private readonly assetDiscoveryService: MetaAssetDiscoveryService,
    private readonly cryptoService: SettingsCryptoService,
    private readonly channelConnectionService: FacebookMessengerChannelConnectionService,
  ) {}

  async start(input: StartFacebookMessengerOAuthInput) {
    const callbackUrl = requireFacebookLoginCallbackUrl();
    requireLeadFlowFrontendUrl();
    const loginConfig = this.metaGraphService.getFacebookLoginConfig();
    const state = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + FACEBOOK_LOGIN_SESSION_TTL_MS);
    const session = this.sessionsRepository.create({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      provider: 'meta',
      channelType: MESSENGER_SESSION_CHANNEL_TYPE,
      status: 'pending',
      state: hashFacebookOAuthState(state),
      code: null,
      payload: {},
      metadata: {
        ...(input.metadata ?? {}),
        authorizationMethod: 'facebook_login',
        stage: FACEBOOK_LOGIN_OAUTH_STARTED_STAGE,
        stateStorage: 'sha256',
        permissionSource: 'meta_dashboard_config',
        startedAt: new Date().toISOString(),
      },
      expiresAt,
      completedAt: null,
    });

    await this.sessionsRepository.save(session);

    const authorizationUrl = buildFacebookLoginAuthorizationUrl({
      loginConfig,
      callbackUrl,
      state,
    });

    return {
      authorizationUrl: authorizationUrl.toString(),
      expiresAt,
    };
  }

  async handleCallback(input: FacebookLoginCallbackInput) {
    let outcome: CallbackOutcome;

    try {
      outcome = await this.complete(input);
    } catch {
      outcome = { ok: false, reason: 'session_persistence_failed' };
    }

    return this.buildFrontendRedirect(outcome);
  }

  async getSessionAssets(input: GetFacebookMessengerSessionAssetsInput) {
    let session: InboxChannelConnectionSessionEntity | null;
    try {
      session = await this.sessionsRepository.findOne({
        where: {
          id: input.sessionId,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          provider: 'meta',
          channelType: MESSENGER_SESSION_CHANNEL_TYPE,
        },
      });
    } catch {
      throw new BadRequestException('invalid_session');
    }

    if (!session) {
      throw new BadRequestException('invalid_session');
    }
    if (session.status === 'expired') {
      throw new BadRequestException('session_expired');
    }
    if (session.status !== 'pending') {
      throw new BadRequestException('session_consumed');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('session_expired');
    }
    if (
      session.metadata?.authorizationMethod !== 'facebook_login' ||
      session.metadata?.stage !== FACEBOOK_LOGIN_ASSET_SELECTION_STAGE
    ) {
      throw new BadRequestException('invalid_session');
    }
    if (session.userId !== null && session.userId !== input.userId) {
      throw new BadRequestException('invalid_session');
    }

    const payload = isRecord(session.payload) ? session.payload : {};
    const assets = this.parseSelectablePages(payload.selectableAssets);
    if (!assets) {
      throw new BadRequestException('invalid_asset_payload');
    }

    return {
      sessionId: session.id,
      assets: assets.map((asset) => ({
        pageId: asset.pageId,
        pageName: asset.pageName,
        tasks: asset.tasks,
        messagingEligible: this.hasMessagingAccess(asset),
      })),
    };
  }

  async select(input: SelectFacebookMessengerPageInput) {
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
            channelType: MESSENGER_SESSION_CHANNEL_TYPE,
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
          session.metadata?.stage !== FACEBOOK_LOGIN_ASSET_SELECTION_STAGE
        ) {
          return { ok: false, code: 'invalid_session' };
        }
        if (session.userId !== null && session.userId !== input.userId) {
          return { ok: false, code: 'invalid_session' };
        }

        const payload = isRecord(session.payload) ? session.payload : {};
        const selectedAsset = this.findSelectablePage(
          payload.selectableAssets,
          input.pageId,
        );
        if (!selectedAsset) {
          return { ok: false, code: 'asset_not_available' };
        }
        if (!this.hasMessagingAccess(selectedAsset)) {
          return { ok: false, code: 'page_missing_messaging_access' };
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

        // The subscription call is the live revalidation: it only succeeds when
        // the Page Access Token from this session still grants messaging on
        // exactly this Page. A failure must never leave a connected channel.
        try {
          await this.metaGraphService.subscribeFacebookPageToMessengerWebhooks({
            pageId: input.pageId,
            pageAccessToken: pageCredential.pageAccessToken,
          });
        } catch {
          return { ok: false, code: 'webhook_subscription_failed' };
        }

        const channel = await this.channelConnectionService.connect(manager, {
          session,
          pageId: input.pageId,
          pageName: selectedAsset.pageName || null,
          pageTasks: selectedAsset.tasks,
          pageAccessToken: pageCredential.pageAccessToken,
          subscribedFields: FACEBOOK_PAGE_MESSENGER_WEBHOOK_FIELDS,
          authorizationMethod: 'facebook_login',
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

  private async complete(
    input: FacebookLoginCallbackInput,
  ): Promise<CallbackOutcome> {
    if (!isAcceptableFacebookOAuthState(input.state)) {
      return { ok: false, reason: 'invalid_state' };
    }

    const stateHash = hashFacebookOAuthState(input.state);

    return this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(
        InboxChannelConnectionSessionEntity,
      );
      const session = await sessions.findOne({
        where: {
          state: stateHash,
          provider: 'meta',
          channelType: MESSENGER_SESSION_CHANNEL_TYPE,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!session) {
        return { ok: false, reason: 'invalid_state' };
      }

      if (
        session.status !== 'pending' ||
        session.metadata?.authorizationMethod !== 'facebook_login' ||
        session.metadata?.stage !== FACEBOOK_LOGIN_OAUTH_STARTED_STAGE
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

      const redirectUri = requireFacebookLoginCallbackUrl().toString();

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

      // Messenger works on any Page: a missing Instagram Professional Account
      // must not filter the Page out of the selection snapshot.
      if (assets.length === 0) {
        await this.finishSessionWithError(
          sessions,
          session,
          'failed',
          'no_assets_available',
        );
        return { ok: false, reason: 'no_assets_available' };
      }

      const selectableAssets: SelectableMessengerPage[] = assets.map(
        (asset) => ({
          pageId: asset.pageId,
          pageName: asset.pageName,
          tasks: asset.tasks,
        }),
      );
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
          stage: FACEBOOK_LOGIN_ASSET_SELECTION_STAGE,
          discoveredAt: new Date().toISOString(),
          selectableAssetCount: selectableAssets.length,
          messagingEligibleAssetCount: selectableAssets.filter((asset) =>
            this.hasMessagingAccess(asset),
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
      '/leadflow/inbox/settings/oauth/facebook-messenger',
      requireLeadFlowFrontendUrl(),
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

  private hasMessagingAccess(asset: SelectableMessengerPage) {
    return asset.tasks.some(
      (task) => task.trim().toUpperCase() === MESSENGER_REQUIRED_PAGE_TASK,
    );
  }

  private findSelectablePage(
    value: unknown,
    pageId: string,
  ): SelectableMessengerPage | null {
    const assets = this.parseSelectablePages(value);
    if (!assets) return null;

    return assets.find((asset) => asset.pageId === pageId) ?? null;
  }

  private parseSelectablePages(
    value: unknown,
  ): SelectableMessengerPage[] | null {
    if (!Array.isArray(value)) return null;

    const assets: SelectableMessengerPage[] = [];
    for (const candidate of value as unknown[]) {
      if (
        !isRecord(candidate) ||
        !isNonEmptyString(candidate.pageId) ||
        typeof candidate.pageName !== 'string' ||
        !Array.isArray(candidate.tasks) ||
        !candidate.tasks.every((task) => typeof task === 'string')
      ) {
        return null;
      }

      assets.push({
        pageId: candidate.pageId,
        pageName: candidate.pageName,
        tasks: candidate.tasks,
      });
    }

    return assets;
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
      !isRecord(parsed) ||
      !isNonEmptyString(parsed.userAccessToken) ||
      !Array.isArray(parsed.pageCredentials)
    ) {
      return null;
    }

    const pageCredentials: EncryptedFacebookCredentials['pageCredentials'] = [];
    const pageIds = new Set<string>();
    for (const candidate of parsed.pageCredentials) {
      if (
        !isRecord(candidate) ||
        !isNonEmptyString(candidate.pageId) ||
        !isNonEmptyString(candidate.pageAccessToken) ||
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
}
