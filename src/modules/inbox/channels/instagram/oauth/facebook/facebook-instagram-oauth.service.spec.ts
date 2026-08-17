/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- Jest/TypeORM test doubles intentionally expose partial dynamic repository shapes. */
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { DataSource, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../../../../common/crypto/settings-crypto.service';
import { InboxChannelConnectionSessionEntity } from '../../../../entities/inbox-channel-connection-session.entity';
import type { MetaAssetDiscoveryService } from '../../../meta/services/meta-asset-discovery.service';
import type { MetaGraphService } from '../../../meta/services/meta-graph.service';
import { FacebookInstagramOAuthService } from './facebook-instagram-oauth.service';

describe('FacebookInstagramOAuthService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      META_FACEBOOK_OAUTH_CALLBACK_URL:
        'https://api.example.com/api/inbox/channels/instagram/oauth/facebook/callback',
      LEADFLOW_FRONTEND_URL: 'https://leadflow.example.com',
      SETTINGS_ENCRYPTION_KEY: 'facebook-oauth-test-encryption-key',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('creates the expected pending session and a config-driven safe URL', async () => {
    const harness = createHarness();
    const first = await harness.service.start({
      tenantId: 'tenant-id',
      workspaceId: 'workspace-id',
      userId: 'user-id',
      metadata: { clientId: 'client-id' },
    });
    const second = await harness.service.start({
      tenantId: 'tenant-id',
      workspaceId: 'workspace-id',
      userId: 'user-id',
    });

    const firstUrl = new URL(first.authorizationUrl);
    const secondUrl = new URL(second.authorizationUrl);
    const firstState = firstUrl.searchParams.get('state') as string;
    const savedSession = harness.startSessions.save.mock.calls[0][0];

    expect(`${firstUrl.origin}${firstUrl.pathname}`).toBe(
      'https://www.facebook.com/v26.0/dialog/oauth',
    );
    expect(firstUrl.searchParams.get('client_id')).toBe('meta-app-id');
    expect(firstUrl.searchParams.get('redirect_uri')).toBe(
      process.env.META_FACEBOOK_OAUTH_CALLBACK_URL,
    );
    expect(firstUrl.searchParams.get('response_type')).toBe('code');
    expect(firstUrl.searchParams.get('override_default_response_type')).toBe(
      'true',
    );
    expect(firstUrl.searchParams.get('config_id')).toBe('business-config-id');
    expect(firstUrl.searchParams.has('scope')).toBe(false);
    expect(firstUrl.searchParams.has('client_secret')).toBe(false);
    expect(firstState).not.toBe(secondUrl.searchParams.get('state'));
    expect(savedSession.state).toBe(hash(firstState));
    expect(savedSession.state).not.toBe(firstState);
    expect(savedSession).toMatchObject({
      tenantId: 'tenant-id',
      workspaceId: 'workspace-id',
      userId: 'user-id',
      provider: 'meta',
      channelType: 'instagram',
      status: 'pending',
      code: null,
      payload: {},
      completedAt: null,
      metadata: expect.objectContaining({
        authorizationMethod: 'facebook_login',
        stage: 'oauth_started',
        stateStorage: 'sha256',
        permissionSource: 'meta_dashboard_config',
        clientId: 'client-id',
      }),
    });
  });

  it('preserves multiple Pages, encrypts every credential, and awaits selection', async () => {
    const harness = createHarness();

    const redirect = await harness.service.handleCallback({
      state: 'valid-state',
      code: 'authorization-code',
    });

    expect(harness.meta.exchangeFacebookOAuthCode).toHaveBeenCalledWith({
      code: 'authorization-code',
      redirectUri: process.env.META_FACEBOOK_OAUTH_CALLBACK_URL,
    });
    expect(harness.discovery.discoverFacebookPageAssets).toHaveBeenCalledWith(
      'user-secret-token',
    );
    expect(harness.transactionSessions.findOne).toHaveBeenCalledWith({
      where: {
        state: hash('valid-state'),
        provider: 'meta',
        channelType: 'instagram',
      },
      lock: { mode: 'pessimistic_write' },
    });
    expect(harness.session).toMatchObject({
      status: 'pending',
      completedAt: null,
      code: null,
      errorMessage: null,
      metadata: expect.objectContaining({
        authorizationMethod: 'facebook_login',
        stage: 'asset_selection',
        selectableAssetCount: 2,
        instagramAssetCount: 1,
      }),
      payload: {
        credentialsEncrypted: expect.any(String),
        selectableAssets: [
          {
            pageId: 'page-1',
            pageName: 'Page One',
            instagramAccountId: 'instagram-1',
            instagramUsername: 'page.one',
          },
          {
            pageId: 'page-2',
            pageName: 'Page Two',
            instagramAccountId: null,
            instagramUsername: null,
          },
        ],
      },
    });

    const persistedJson = JSON.stringify(harness.session);
    expect(persistedJson).not.toContain('user-secret-token');
    expect(persistedJson).not.toContain('page-secret-1');
    expect(persistedJson).not.toContain('page-secret-2');

    const encrypted = harness.session.payload.credentialsEncrypted as string;
    expect(JSON.parse(harness.crypto.decrypt(encrypted) as string)).toEqual({
      userAccessToken: 'user-secret-token',
      pageCredentials: [
        { pageId: 'page-1', pageAccessToken: 'page-secret-1' },
        { pageId: 'page-2', pageAccessToken: 'page-secret-2' },
      ],
    });

    const redirectUrl = new URL(redirect);
    expect(redirectUrl.searchParams.get('status')).toBe('select_asset');
    expect(redirectUrl.searchParams.get('session')).toBe('session-id');
    expect(redirect).not.toContain('user-secret-token');
    expect(redirect).not.toContain('page-secret');
    expect(redirect).not.toContain('authorization-code');
  });

  it('rejects invalid, expired, consumed, and incompatible sessions', async () => {
    const invalid = createHarness({ session: null });
    expect(
      errorReason(
        await invalid.service.handleCallback({
          state: 'unknown-state',
          code: 'authorization-code',
        }),
      ),
    ).toBe('invalid_state');
    expect(invalid.meta.exchangeFacebookOAuthCode).not.toHaveBeenCalled();

    const expiredSession = sessionFixture({
      expiresAt: new Date(Date.now() - 1),
    });
    const expired = createHarness({ session: expiredSession });
    expect(
      errorReason(
        await expired.service.handleCallback({
          state: 'valid-state',
          code: 'authorization-code',
        }),
      ),
    ).toBe('session_expired');
    expect(expiredSession.status).toBe('expired');

    for (const session of [
      sessionFixture({ status: 'completed' }),
      sessionFixture({ metadata: { authorizationMethod: 'instagram_login' } }),
      sessionFixture({
        metadata: {
          authorizationMethod: 'facebook_login',
          stage: 'asset_selection',
        },
      }),
    ]) {
      const consumed = createHarness({ session });
      expect(
        errorReason(
          await consumed.service.handleCallback({
            state: 'valid-state',
            code: 'authorization-code',
          }),
        ),
      ).toBe('session_consumed');
      expect(consumed.meta.exchangeFacebookOAuthCode).not.toHaveBeenCalled();
    }
  });

  it('handles OAuth denial and missing code with sanitized failures', async () => {
    const denied = createHarness();
    const deniedRedirect = await denied.service.handleCallback({
      state: 'valid-state',
      error: 'access_denied_with_private_detail',
      errorDescription: 'provider included user-secret-token',
    });
    expect(errorReason(deniedRedirect)).toBe('oauth_denied');
    expect(JSON.stringify(denied.session)).not.toContain('private_detail');
    expect(JSON.stringify(denied.session)).not.toContain('user-secret-token');

    const missing = createHarness();
    const missingRedirect = await missing.service.handleCallback({
      state: 'valid-state',
    });
    expect(errorReason(missingRedirect)).toBe('missing_code');
    expect(missing.meta.exchangeFacebookOAuthCode).not.toHaveBeenCalled();
  });

  it.each([
    ['token_exchange_failed', 'token'],
    ['asset_discovery_failed', 'discovery'],
  ] as const)(
    'sanitizes %s without persisting provider details',
    async (reason, failure) => {
      const harness = createHarness();
      if (failure === 'token') {
        harness.meta.exchangeFacebookOAuthCode.mockRejectedValue(
          new BadRequestException(
            'provider included authorization-code and user-secret-token',
          ),
        );
      } else {
        harness.discovery.discoverFacebookPageAssets.mockRejectedValue(
          new BadRequestException(
            'provider included user-secret-token and page-secret-1',
          ),
        );
      }

      const redirect = await harness.service.handleCallback({
        state: 'valid-state',
        code: 'authorization-code',
      });

      expect(errorReason(redirect)).toBe(reason);
      expect(redirect).not.toContain('authorization-code');
      expect(redirect).not.toContain('user-secret-token');
      expect(JSON.stringify(harness.session)).not.toContain('page-secret-1');
      expect(harness.session.errorMessage).toBe(reason);
    },
  );

  it('fails safely when Facebook returns no Pages', async () => {
    const harness = createHarness({ assets: [] });

    const redirect = await harness.service.handleCallback({
      state: 'valid-state',
      code: 'authorization-code',
    });

    expect(errorReason(redirect)).toBe('no_assets_available');
    expect(harness.session.status).toBe('failed');
    expect(harness.session.payload).toEqual({});
    expect(harness.decryptSpy).not.toHaveBeenCalled();
  });

  it('sanitizes encryption failures and never leaves plaintext in the session', async () => {
    const harness = createHarness();
    jest.spyOn(harness.crypto, 'encrypt').mockImplementation(() => {
      throw new Error('failed with user-secret-token');
    });

    const redirect = await harness.service.handleCallback({
      state: 'valid-state',
      code: 'authorization-code',
    });

    expect(errorReason(redirect)).toBe('session_persistence_failed');
    expect(JSON.stringify(harness.session)).not.toContain('user-secret-token');
    expect(JSON.stringify(harness.session)).not.toContain('page-secret-1');
  });
});

function createHarness(
  options: {
    session?: InboxChannelConnectionSessionEntity | null;
    assets?: Array<{
      pageId: string;
      pageName: string;
      pageAccessToken: string;
      instagramAccount: { accountId: string; username: string | null } | null;
    }>;
  } = {},
) {
  const session =
    options.session === undefined ? sessionFixture() : options.session;
  const startSessions = {
    create: jest.fn((value) => ({ id: 'start-session-id', ...value })),
    save: jest.fn(async (value) => value),
  };
  const transactionSessions = {
    findOne: jest.fn(async () => session),
    save: jest.fn(async (value) => value),
  };
  const manager = {
    getRepository: jest.fn(() => transactionSessions),
  };
  const dataSource = {
    transaction: jest.fn(async (work) => work(manager)),
  };
  const meta = {
    getFacebookLoginConfig: jest.fn(() => ({
      appId: 'meta-app-id',
      configId: 'business-config-id',
      authorizationEndpoint: 'https://www.facebook.com/v26.0/dialog/oauth',
    })),
    exchangeFacebookOAuthCode: jest.fn(async () => ({
      accessToken: 'user-secret-token',
      tokenType: 'bearer',
      expiresIn: 3_600,
    })),
  };
  const discovery = {
    discoverFacebookPageAssets: jest.fn(
      async () =>
        options.assets ?? [
          {
            pageId: 'page-1',
            pageName: 'Page One',
            pageAccessToken: 'page-secret-1',
            instagramAccount: {
              accountId: 'instagram-1',
              username: 'page.one',
            },
          },
          {
            pageId: 'page-2',
            pageName: 'Page Two',
            pageAccessToken: 'page-secret-2',
            instagramAccount: null,
          },
        ],
    ),
  };
  const crypto = new SettingsCryptoService();
  const decryptSpy = jest.spyOn(crypto, 'decrypt');
  const service = new FacebookInstagramOAuthService(
    startSessions as unknown as Repository<InboxChannelConnectionSessionEntity>,
    dataSource as unknown as DataSource,
    meta as unknown as MetaGraphService,
    discovery as unknown as MetaAssetDiscoveryService,
    crypto,
  );

  return {
    service,
    session: session as InboxChannelConnectionSessionEntity,
    startSessions,
    transactionSessions,
    meta,
    discovery,
    crypto,
    decryptSpy,
  };
}

function sessionFixture(
  overrides: Partial<InboxChannelConnectionSessionEntity> = {},
): InboxChannelConnectionSessionEntity {
  return {
    id: 'session-id',
    tenantId: 'tenant-id',
    workspaceId: 'workspace-id',
    userId: 'user-id',
    provider: 'meta',
    channelType: 'instagram',
    status: 'pending',
    state: hash('valid-state'),
    code: null,
    businessId: null,
    wabaId: null,
    phoneNumberId: null,
    displayPhoneNumber: null,
    errorMessage: null,
    payload: {},
    metadata: {
      authorizationMethod: 'facebook_login',
      stage: 'oauth_started',
    },
    expiresAt: new Date(Date.now() + 60_000),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function errorReason(redirect: string) {
  return new URL(redirect).searchParams.get('reason');
}
