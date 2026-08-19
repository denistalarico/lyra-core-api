/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/unbound-method -- Jest/TypeORM test doubles intentionally expose partial dynamic repository shapes. */
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { DataSource, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../../../../common/crypto/settings-crypto.service';
import { InboxChannelConnectionSessionEntity } from '../../../../entities/inbox-channel-connection-session.entity';
import { InboxChannelEntity } from '../../../../entities/inbox-channel.entity';
import type { MetaAssetDiscoveryService } from '../../../meta/services/meta-asset-discovery.service';
import type { MetaGraphService } from '../../../meta/services/meta-graph.service';
import { InstagramChannelConnectionService } from '../instagram-channel-connection.service';
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

  it('returns a strict projection of every selectable Page without reading credentials', async () => {
    const session = selectionSessionFixture({
      code: 'oauth-authorization-code',
      metadata: {
        authorizationMethod: 'facebook_login',
        stage: 'asset_selection',
        providerDetail: 'metadata-must-not-leak',
      },
      payload: {
        credentialsEncrypted: 'encrypted-user-and-page-tokens',
        userAccessToken: 'future-user-access-token',
        pageAccessToken: 'future-page-access-token',
        selectableAssets: [
          {
            pageId: '123',
            pageName: 'Page with Instagram',
            instagramAccountId: 'instagram-123',
            instagramUsername: 'page.with.instagram',
            futureSecret: 'must-not-leak',
          },
          {
            pageId: '456',
            pageName: 'Page without Instagram',
            instagramAccountId: null,
            instagramUsername: null,
          },
        ],
      },
    });
    const harness = createHarness({ session });

    const result = await harness.service.getSessionAssets(assetsInput());

    expect(harness.startSessions.findOne).toHaveBeenCalledWith({
      where: {
        id: 'session-id',
        tenantId: 'tenant-id',
        workspaceId: 'workspace-id',
        provider: 'meta',
        channelType: 'instagram',
      },
    });
    expect(result).toEqual({
      sessionId: 'session-id',
      assets: [
        {
          pageId: '123',
          pageName: 'Page with Instagram',
          instagramAccountId: 'instagram-123',
          instagramUsername: 'page.with.instagram',
        },
        {
          pageId: '456',
          pageName: 'Page without Instagram',
          instagramAccountId: null,
          instagramUsername: null,
        },
      ],
    });
    const responseJson = JSON.stringify(result);
    expect(responseJson).not.toContain('credentialsEncrypted');
    expect(responseJson).not.toContain('encrypted-user-and-page-tokens');
    expect(responseJson).not.toContain('future-user-access-token');
    expect(responseJson).not.toContain('future-page-access-token');
    expect(responseJson).not.toContain('must-not-leak');
    expect(responseJson).not.toContain('metadata-must-not-leak');
    expect(responseJson).not.toContain('oauth-authorization-code');
    expect(harness.decryptSpy).not.toHaveBeenCalled();
    expect(harness.dataSource.transaction).not.toHaveBeenCalled();
    expect(harness.meta.exchangeFacebookOAuthCode).not.toHaveBeenCalled();
    expect(harness.meta.getFacebookPageInstagramAccount).not.toHaveBeenCalled();
    expect(
      harness.meta.subscribeFacebookPageToInstagramWebhooks,
    ).not.toHaveBeenCalled();
    expect(harness.discovery.discoverFacebookPageAssets).not.toHaveBeenCalled();
    expect(harness.channels.create).not.toHaveBeenCalled();
    expect(harness.channels.save).not.toHaveBeenCalled();
    expect(harness.startSessions.save).not.toHaveBeenCalled();
  });

  it.each([
    ['tenant', { tenantId: 'other-tenant' }],
    ['workspace', { workspaceId: 'other-workspace' }],
  ] as const)(
    'does not authorize a known session id from another %s',
    async (_scope, override) => {
      const harness = createHarness({ session: selectionSessionFixture() });

      const exception = await assetsFailure(harness, {
        ...assetsInput(),
        ...override,
      });

      expect(exception.message).toBe('invalid_session');
      expect(harness.decryptSpy).not.toHaveBeenCalled();
      expect(
        harness.meta.getFacebookPageInstagramAccount,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['another owner', 'other-user'],
    ['no request user', null],
  ] as const)('rejects session assets for %s', async (_case, userId) => {
    const harness = createHarness({ session: selectionSessionFixture() });

    const exception = await assetsFailure(harness, {
      ...assetsInput(),
      userId,
    });

    expect(exception.message).toBe('invalid_session');
    expect(harness.decryptSpy).not.toHaveBeenCalled();
  });

  it('allows a valid session without an owner', async () => {
    const harness = createHarness({
      session: selectionSessionFixture({ userId: null }),
    });

    await expect(
      harness.service.getSessionAssets({ ...assetsInput(), userId: null }),
    ).resolves.toMatchObject({ sessionId: 'session-id' });
  });

  it.each([
    ['session_consumed', { status: 'completed' as const }],
    ['session_expired', { status: 'expired' as const }],
    [
      'invalid_session',
      {
        metadata: {
          authorizationMethod: 'facebook_login',
          stage: 'oauth_started',
        },
      },
    ],
    [
      'invalid_session',
      {
        metadata: {
          authorizationMethod: 'instagram_login',
          stage: 'asset_selection',
        },
      },
    ],
  ])('rejects invalid assets lifecycle as %s', async (code, override) => {
    const harness = createHarness({
      session: selectionSessionFixture(
        override as Partial<InboxChannelConnectionSessionEntity>,
      ),
    });

    const exception = await assetsFailure(harness);

    expect(exception.message).toBe(code);
    expect(harness.startSessions.save).not.toHaveBeenCalled();
  });

  it('reports an elapsed TTL without mutating the session', async () => {
    const session = selectionSessionFixture({
      expiresAt: new Date(Date.now() - 1),
    });
    const harness = createHarness({ session });

    const exception = await assetsFailure(harness);

    expect(exception.message).toBe('session_expired');
    expect(session.status).toBe('pending');
    expect(session.errorMessage).toBeNull();
    expect(harness.startSessions.save).not.toHaveBeenCalled();
  });

  it.each([
    ['missing array', undefined],
    ['non-array value', { pageId: '123' }],
    ['non-object asset', [null]],
    [
      'empty page id',
      [
        {
          pageId: '  ',
          pageName: 'Page',
          instagramAccountId: null,
          instagramUsername: null,
        },
      ],
    ],
    [
      'invalid page name',
      [
        {
          pageId: '123',
          pageName: 123,
          instagramAccountId: null,
          instagramUsername: null,
        },
      ],
    ],
    [
      'invalid Instagram account id',
      [
        {
          pageId: '123',
          pageName: 'Page',
          instagramAccountId: undefined,
          instagramUsername: null,
        },
      ],
    ],
    [
      'invalid Instagram username',
      [
        {
          pageId: '123',
          pageName: 'Page',
          instagramAccountId: null,
          instagramUsername: undefined,
        },
      ],
    ],
  ])('rejects %s as invalid_asset_payload', async (_case, selectableAssets) => {
    const session = selectionSessionFixture();
    session.payload = {
      credentialsEncrypted: 'ciphertext-must-not-leak',
      ...(selectableAssets === undefined ? {} : { selectableAssets }),
    };
    const harness = createHarness({ session });

    const exception = await assetsFailure(harness);

    expect(exception.message).toBe('invalid_asset_payload');
    expect(exception.message).not.toContain('ciphertext-must-not-leak');
    expect(harness.decryptSpy).not.toHaveBeenCalled();
    expect(harness.meta.getFacebookPageInstagramAccount).not.toHaveBeenCalled();
    expect(harness.channels.save).not.toHaveBeenCalled();
  });

  it('selects a revalidated asset, connects one Instagram channel, and completes the session', async () => {
    const harness = createHarness({ session: selectionSessionFixture() });

    const result = await harness.service.select(selectionInput());

    expect(result).toEqual({ channelId: 'new-channel-id' });
    expect(harness.transactionSessions.findOne).toHaveBeenCalledWith({
      where: {
        id: 'session-id',
        tenantId: 'tenant-id',
        workspaceId: 'workspace-id',
        provider: 'meta',
        channelType: 'instagram',
      },
      lock: { mode: 'pessimistic_write' },
    });
    expect(harness.meta.getFacebookPageInstagramAccount).toHaveBeenCalledWith({
      pageId: '123',
      pageAccessToken: 'page-selection-secret',
    });
    expect(
      harness.meta.subscribeFacebookPageToInstagramWebhooks,
    ).toHaveBeenCalledWith({
      pageId: '123',
      pageAccessToken: 'page-selection-secret',
    });
    expect(harness.manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      ['tenant-id:workspace-id', 'instagram:meta:instagram-123'],
    );
    expect(harness.channels.create).toHaveBeenCalledTimes(1);
    expect(harness.channels.save).toHaveBeenCalledTimes(1);
    expect(harness.channels.save.mock.calls[0][0]).toMatchObject({
      type: 'instagram',
      provider: 'meta',
      externalAccountId: 'instagram-123',
      externalPageId: '123',
      credentialVersion: 1,
      lifecycleVersion: 1,
      settings: { connectionHealth: 'ok' },
      metadata: expect.objectContaining({
        authorizationMethod: 'facebook_login',
        facebookPageId: '123',
        connectionSessionId: 'session-id',
        username: 'current.username',
      }),
    });
    const savedChannel = harness.channels.save.mock.calls[0][0];
    expect(harness.crypto.decrypt(savedChannel.accessTokenEncrypted)).toBe(
      'page-selection-secret',
    );
    expect(harness.session).toMatchObject({
      status: 'completed',
      errorMessage: null,
      completedAt: expect.any(Date),
      metadata: expect.objectContaining({
        stage: 'completed',
        channelId: 'new-channel-id',
        selectedPageId: '123',
        selectedInstagramAccountId: 'instagram-123',
      }),
    });
    expect(harness.session.payload).toEqual({
      selectableAssets: [
        {
          pageId: '123',
          pageName: 'Selected Page',
          instagramAccountId: 'instagram-123',
          instagramUsername: 'discovered.username',
        },
      ],
    });
    expect(JSON.stringify(harness.session)).not.toContain(
      'page-selection-secret',
    );
    expect(JSON.stringify(harness.session)).not.toContain(
      'user-selection-secret',
    );
  });

  it.each([
    ['tenant', { tenantId: 'other-tenant' }],
    ['workspace', { workspaceId: 'other-workspace' }],
  ] as const)('rejects a session from another %s', async (_scope, override) => {
    const harness = createHarness({ session: selectionSessionFixture() });

    const exception = await selectionFailure(harness, {
      ...selectionInput(),
      ...override,
    });

    expect(exception.message).toBe('invalid_session');
    expect(harness.meta.getFacebookPageInstagramAccount).not.toHaveBeenCalled();
  });

  it('rejects incompatible user ownership', async () => {
    const harness = createHarness({ session: selectionSessionFixture() });
    const exception = await selectionFailure(harness, {
      ...selectionInput(),
      userId: 'other-user',
    });
    expect(exception.message).toBe('invalid_session');
  });

  it('rejects a missing request user when the session has an owner', async () => {
    const harness = createHarness({ session: selectionSessionFixture() });
    const exception = await selectionFailure(harness, {
      ...selectionInput(),
      userId: null,
    });

    expect(exception.message).toBe('invalid_session');
    expect(harness.meta.getFacebookPageInstagramAccount).not.toHaveBeenCalled();
  });

  it('preserves nullable session ownership behavior', async () => {
    const nullableOwnership = createHarness({
      session: selectionSessionFixture({ userId: null }),
    });
    await expect(
      nullableOwnership.service.select(selectionInput()),
    ).resolves.toEqual({ channelId: 'new-channel-id' });
  });

  it.each([
    ['session_expired', { expiresAt: new Date(Date.now() - 1) }],
    [
      'invalid_session',
      {
        metadata: {
          authorizationMethod: 'facebook_login',
          stage: 'oauth_started',
        },
      },
    ],
    ['session_consumed', { status: 'completed' as const }],
  ])('rejects invalid session lifecycle as %s', async (code, override) => {
    const harness = createHarness({
      session: selectionSessionFixture(
        override as Partial<InboxChannelConnectionSessionEntity>,
      ),
    });

    const exception = await selectionFailure(harness);

    expect(exception.message).toBe(code);
    expect(harness.channels.save).not.toHaveBeenCalled();
  });

  it('rejects a Page that was not offered in selectableAssets', async () => {
    const harness = createHarness({ session: selectionSessionFixture() });

    const exception = await selectionFailure(harness, {
      ...selectionInput(),
      pageId: '999',
    });

    expect(exception.message).toBe('asset_not_available');
    expect(harness.crypto.decrypt).not.toHaveBeenCalled();
  });

  it.each([
    ['missing encrypted credentials', undefined, 'invalid_credential_payload'],
    ['malformed JSON', 'not-json', 'invalid_credential_payload'],
    [
      'malformed payload',
      JSON.stringify({ userAccessToken: 'user-selection-secret' }),
      'invalid_credential_payload',
    ],
    [
      'missing selected Page credential',
      JSON.stringify({
        userAccessToken: 'user-selection-secret',
        pageCredentials: [
          { pageId: '999', pageAccessToken: 'other-page-secret' },
        ],
      }),
      'invalid_credential_payload',
    ],
  ])('rejects %s defensively', async (_case, plaintext, code) => {
    const session = selectionSessionFixture();
    session.payload = {
      ...session.payload,
      ...(plaintext === undefined
        ? {}
        : {
            credentialsEncrypted: new SettingsCryptoService().encrypt(
              plaintext,
            ),
          }),
    };
    if (plaintext === undefined) delete session.payload.credentialsEncrypted;
    const harness = createHarness({ session });

    const exception = await selectionFailure(harness);

    expect(exception.message).toBe(code);
    expect(harness.channels.save).not.toHaveBeenCalled();
  });

  it('rejects credential decryption failure without leaking ciphertext details', async () => {
    const harness = createHarness({ session: selectionSessionFixture() });
    jest.spyOn(harness.crypto, 'decrypt').mockImplementation(() => {
      throw new Error('decrypt failed with page-selection-secret');
    });

    const exception = await selectionFailure(harness);

    expect(exception.message).toBe('credential_decryption_failed');
    expect(exception.message).not.toContain('page-selection-secret');
    expect(harness.channels.save).not.toHaveBeenCalled();
  });

  it.each([
    ['selected_page_has_no_instagram', null],
    [
      'instagram_asset_changed',
      { accountId: 'changed-instagram-id', username: 'changed' },
    ],
  ] as const)(
    'rejects revalidated asset drift as %s',
    async (code, account) => {
      const harness = createHarness({ session: selectionSessionFixture() });
      harness.meta.getFacebookPageInstagramAccount.mockResolvedValue(
        account as never,
      );

      const exception = await selectionFailure(harness);

      expect(exception.message).toBe(code);
      expect(
        harness.meta.subscribeFacebookPageToInstagramWebhooks,
      ).not.toHaveBeenCalled();
      expect(harness.channels.save).not.toHaveBeenCalled();
    },
  );

  it('sanitizes revalidation and webhook failures and never persists a partial channel', async () => {
    const revalidation = createHarness({ session: selectionSessionFixture() });
    revalidation.meta.getFacebookPageInstagramAccount.mockRejectedValue(
      new Error('provider leaked page-selection-secret'),
    );
    const revalidationException = await selectionFailure(revalidation);
    expect(revalidationException.message).toBe('asset_revalidation_failed');
    expect(revalidationException.message).not.toContain(
      'page-selection-secret',
    );

    const webhook = createHarness({ session: selectionSessionFixture() });
    webhook.meta.subscribeFacebookPageToInstagramWebhooks.mockRejectedValue(
      new Error(
        'provider leaked page-selection-secret and user-selection-secret',
      ),
    );
    const webhookException = await selectionFailure(webhook);
    expect(webhookException.message).toBe('webhook_subscription_failed');
    expect(webhookException.message).not.toContain('page-selection-secret');
    expect(webhookException.message).not.toContain('user-selection-secret');
    expect(webhook.channels.create).not.toHaveBeenCalled();
    expect(webhook.channels.save).not.toHaveBeenCalled();
    expect(webhook.session.status).toBe('pending');
  });

  it('rolls back selection with a sanitized persistence failure', async () => {
    const harness = createHarness({ session: selectionSessionFixture() });
    harness.channels.save.mockRejectedValue(
      new Error(
        'database failure included page-selection-secret and user-selection-secret',
      ),
    );

    const exception = await selectionFailure(harness);

    expect(exception.message).toBe('channel_persistence_failed');
    expect(exception.message).not.toContain('page-selection-secret');
    expect(exception.message).not.toContain('user-selection-secret');
    expect(harness.session.status).toBe('pending');
    expect(harness.session.completedAt).toBeNull();
  });

  it('reuses a direct-login channel without duplication and preserves configuration', async () => {
    const existing = channelFixture({
      credentialVersion: 7,
      lifecycleVersion: 3,
      externalId: 'direct-scoped-id',
      externalPageId: null,
      settings: { routing: 'preserved', connectionHealth: 'stale' },
      metadata: {
        authorizationMethod: 'instagram_login',
        unrelatedAudit: 'preserved',
      },
    });
    const harness = createHarness({
      session: selectionSessionFixture(),
      existingChannel: existing,
    });

    const result = await harness.service.select(selectionInput());

    expect(result).toEqual({ channelId: 'channel-id' });
    expect(harness.channels.create).not.toHaveBeenCalled();
    expect(harness.channels.save).toHaveBeenCalledWith(existing);
    expect(existing).toMatchObject({
      externalAccountId: 'instagram-123',
      externalId: 'direct-scoped-id',
      externalPageId: '123',
      credentialVersion: 8,
      lifecycleVersion: 3,
      settings: {
        routing: 'preserved',
        connectionHealth: 'ok',
      },
      metadata: expect.objectContaining({
        authorizationMethod: 'facebook_login',
        unrelatedAudit: 'preserved',
        facebookPageId: '123',
      }),
    });
    expect(harness.crypto.decrypt(existing.accessTokenEncrypted)).toBe(
      'page-selection-secret',
    );
  });
});

function createHarness(
  options: {
    session?: InboxChannelConnectionSessionEntity | null;
    existingChannel?: InboxChannelEntity | null;
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
    findOne: jest.fn(async (query?: { where?: Record<string, unknown> }) => {
      if (!session) return null;
      const where = query?.where ?? {};
      return Object.entries(where).every(
        ([property, value]) =>
          (session as unknown as Record<string, unknown>)[property] === value,
      )
        ? session
        : null;
    }),
    save: jest.fn(async (value) => value),
  };
  const transactionSessions = {
    findOne: jest.fn(async (query?: { where?: Record<string, unknown> }) => {
      if (!session) return null;
      const where = query?.where ?? {};
      return Object.entries(where).every(
        ([property, value]) =>
          (session as unknown as Record<string, unknown>)[property] === value,
      )
        ? session
        : null;
    }),
    save: jest.fn(async (value) => value),
  };
  const channels = {
    findOne: jest.fn(async () => options.existingChannel ?? null),
    create: jest.fn((value) => ({ ...value })),
    save: jest.fn(async (value) => {
      if (!value.id) value.id = 'new-channel-id';
      return value;
    }),
  };
  const manager = {
    getRepository: jest.fn((entity) =>
      entity === InboxChannelConnectionSessionEntity
        ? transactionSessions
        : channels,
    ),
    query: jest.fn(async () => undefined),
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
    getFacebookPageInstagramAccount: jest.fn(async () => ({
      accountId: 'instagram-123',
      username: 'current.username',
    })),
    subscribeFacebookPageToInstagramWebhooks: jest.fn(async () => ({
      success: true as const,
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
    new InstagramChannelConnectionService(crypto),
  );

  return {
    service,
    session: session as InboxChannelConnectionSessionEntity,
    startSessions,
    transactionSessions,
    dataSource,
    channels,
    manager,
    meta,
    discovery,
    crypto,
    decryptSpy,
  };
}

function selectionSessionFixture(
  overrides: Partial<InboxChannelConnectionSessionEntity> = {},
) {
  const crypto = new SettingsCryptoService();
  return sessionFixture({
    payload: {
      credentialsEncrypted: crypto.encrypt(
        JSON.stringify({
          userAccessToken: 'user-selection-secret',
          pageCredentials: [
            {
              pageId: '123',
              pageAccessToken: 'page-selection-secret',
            },
          ],
        }),
      ),
      selectableAssets: [
        {
          pageId: '123',
          pageName: 'Selected Page',
          instagramAccountId: 'instagram-123',
          instagramUsername: 'discovered.username',
        },
      ],
    },
    metadata: {
      authorizationMethod: 'facebook_login',
      stage: 'asset_selection',
      auditContext: 'preserved',
    },
    ...overrides,
  });
}

function selectionInput(): Parameters<
  FacebookInstagramOAuthService['select']
>[0] {
  return {
    tenantId: 'tenant-id',
    workspaceId: 'workspace-id',
    userId: 'user-id',
    sessionId: 'session-id',
    pageId: '123',
  };
}

function assetsInput(): Parameters<
  FacebookInstagramOAuthService['getSessionAssets']
>[0] {
  return {
    tenantId: 'tenant-id',
    workspaceId: 'workspace-id',
    userId: 'user-id',
    sessionId: 'session-id',
  };
}

async function assetsFailure(
  harness: ReturnType<typeof createHarness>,
  input = assetsInput(),
) {
  try {
    await harness.service.getSessionAssets(input);
    throw new Error('Expected Facebook Instagram session assets to fail.');
  } catch (error) {
    return error as BadRequestException;
  }
}

async function selectionFailure(
  harness: ReturnType<typeof createHarness>,
  input = selectionInput(),
) {
  try {
    await harness.service.select(input);
    throw new Error('Expected Facebook Instagram selection to fail.');
  } catch (error) {
    return error as BadRequestException;
  }
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

function channelFixture(
  overrides: Partial<InboxChannelEntity> = {},
): InboxChannelEntity {
  return {
    id: 'channel-id',
    tenantId: 'tenant-id',
    workspaceId: 'workspace-id',
    name: 'Instagram',
    type: 'instagram',
    status: 'active',
    connectionStatus: 'connected',
    lifecycleVersion: 1,
    credentialVersion: 1,
    provider: 'meta',
    externalId: null,
    externalAccountId: 'instagram-123',
    externalPhoneNumberId: null,
    externalPageId: null,
    accessTokenEncrypted: 'encrypted-token',
    verifyToken: null,
    webhookSecret: null,
    defaultAssignedUserId: null,
    defaultAgentId: null,
    defaultPipelineId: null,
    aiEnabled: false,
    settings: {},
    metadata: {},
    suspendedAt: null,
    disconnectedAt: null,
    disconnectedBy: null,
    disconnectReason: null,
    credentialRemovedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function errorReason(redirect: string) {
  return new URL(redirect).searchParams.get('reason');
}
