/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- Jest/TypeORM test doubles intentionally expose partial dynamic repository shapes. */
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { DataSource, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../../../../common/crypto/settings-crypto.service';
import { InboxChannelConnectionSessionEntity } from '../../../../entities/inbox-channel-connection-session.entity';
import { InboxChannelEntity } from '../../../../entities/inbox-channel.entity';
import type { MetaAssetDiscoveryService } from '../../../meta/services/meta-asset-discovery.service';
import type { MetaGraphService } from '../../../meta/services/meta-graph.service';
import { FacebookMessengerChannelConnectionService } from '../facebook-messenger-channel-connection.service';
import { FacebookMessengerOAuthService } from './facebook-messenger-oauth.service';

describe('FacebookMessengerOAuthService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      META_FACEBOOK_OAUTH_CALLBACK_URL:
        'https://api.example.com/api/inbox/channels/instagram/oauth/facebook/callback',
      LEADFLOW_FRONTEND_URL: 'https://leadflow.example.com',
      SETTINGS_ENCRYPTION_KEY: 'messenger-oauth-test-encryption-key',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('start', () => {
    it('creates a Messenger session and a config-driven URL without secrets', async () => {
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
      const firstState = firstUrl.searchParams.get('state') as string;
      const savedSession = harness.startSessions.save.mock.calls[0][0];

      expect(`${firstUrl.origin}${firstUrl.pathname}`).toBe(
        'https://www.facebook.com/v26.0/dialog/oauth',
      );
      expect(firstUrl.searchParams.get('client_id')).toBe('meta-app-id');
      expect(firstUrl.searchParams.get('config_id')).toBe('business-config-id');
      expect(firstUrl.searchParams.get('redirect_uri')).toBe(
        process.env.META_FACEBOOK_OAUTH_CALLBACK_URL,
      );
      expect(firstUrl.searchParams.get('response_type')).toBe('code');
      expect(firstUrl.searchParams.get('override_default_response_type')).toBe(
        'true',
      );
      expect(firstUrl.searchParams.has('scope')).toBe(false);
      expect(firstUrl.searchParams.has('client_secret')).toBe(false);
      expect(firstState).not.toBe(
        new URL(second.authorizationUrl).searchParams.get('state'),
      );
      expect(savedSession.state).toBe(hash(firstState));
      expect(savedSession.state).not.toBe(firstState);
      expect(savedSession).toMatchObject({
        tenantId: 'tenant-id',
        workspaceId: 'workspace-id',
        userId: 'user-id',
        provider: 'meta',
        channelType: 'facebook_messenger',
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
      expect(first.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('callback', () => {
    it('keeps every Page, including Pages without Instagram, and encrypts credentials', async () => {
      const harness = createHarness();

      const redirect = await harness.service.handleCallback({
        state: 'valid-state',
        code: 'authorization-code',
      });

      expect(harness.transactionSessions.findOne).toHaveBeenCalledWith({
        where: {
          state: hash('valid-state'),
          provider: 'meta',
          channelType: 'facebook_messenger',
        },
        lock: { mode: 'pessimistic_write' },
      });
      expect(harness.meta.exchangeFacebookOAuthCode).toHaveBeenCalledWith({
        code: 'authorization-code',
        redirectUri: process.env.META_FACEBOOK_OAUTH_CALLBACK_URL,
      });
      expect(harness.session).toMatchObject({
        status: 'pending',
        errorMessage: null,
        code: null,
        metadata: expect.objectContaining({
          stage: 'asset_selection',
          selectableAssetCount: 3,
          messagingEligibleAssetCount: 2,
        }),
        payload: {
          credentialsEncrypted: expect.any(String),
          selectableAssets: [
            {
              pageId: 'page-1',
              pageName: 'Page With Instagram',
              tasks: ['MESSAGING', 'ANALYZE'],
            },
            {
              pageId: 'page-2',
              pageName: 'Page Without Instagram',
              tasks: ['MESSAGING'],
            },
            {
              pageId: 'page-3',
              pageName: 'Page Without Messaging',
              tasks: ['ANALYZE'],
            },
          ],
        },
      });

      const persistedJson = JSON.stringify(harness.session);
      expect(persistedJson).not.toContain('user-secret-token');
      expect(persistedJson).not.toContain('page-secret-1');
      expect(persistedJson).not.toContain('page-secret-2');
      expect(persistedJson).not.toContain('page-secret-3');

      const encrypted = harness.session.payload.credentialsEncrypted as string;
      expect(JSON.parse(harness.crypto.decrypt(encrypted) as string)).toEqual({
        userAccessToken: 'user-secret-token',
        pageCredentials: [
          { pageId: 'page-1', pageAccessToken: 'page-secret-1' },
          { pageId: 'page-2', pageAccessToken: 'page-secret-2' },
          { pageId: 'page-3', pageAccessToken: 'page-secret-3' },
        ],
      });

      const redirectUrl = new URL(redirect);
      expect(redirectUrl.pathname).toBe(
        '/leadflow/inbox/settings/oauth/facebook-messenger',
      );
      expect(redirectUrl.searchParams.get('status')).toBe('select_asset');
      expect(redirectUrl.searchParams.get('session')).toBe('session-id');
      expect(redirect).not.toContain('authorization-code');
      expect(redirect).not.toContain('user-secret-token');
      expect(redirect).not.toContain('page-secret');
    });

    it('rejects invalid, expired, and consumed sessions', async () => {
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
        sessionFixture({
          metadata: { authorizationMethod: 'instagram_login' },
        }),
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
      expect(
        errorReason(
          await missing.service.handleCallback({ state: 'valid-state' }),
        ),
      ).toBe('missing_code');
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
      expect(JSON.stringify(harness.session)).not.toContain(
        'user-secret-token',
      );
      expect(JSON.stringify(harness.session)).not.toContain('page-secret-1');
    });
  });

  describe('session assets', () => {
    it('returns every Page with its messaging eligibility and no credentials', async () => {
      const harness = createHarness({ session: selectionSessionFixture() });

      const result = await harness.service.getSessionAssets(assetsInput());

      expect(harness.startSessions.findOne).toHaveBeenCalledWith({
        where: {
          id: 'session-id',
          tenantId: 'tenant-id',
          workspaceId: 'workspace-id',
          provider: 'meta',
          channelType: 'facebook_messenger',
        },
      });
      expect(result).toEqual({
        sessionId: 'session-id',
        assets: [
          {
            pageId: '123',
            pageName: 'Selected Page',
            tasks: ['MESSAGING', 'ANALYZE'],
            messagingEligible: true,
          },
          {
            pageId: '456',
            pageName: 'Page Without Messaging',
            tasks: ['ANALYZE'],
            messagingEligible: false,
          },
        ],
      });

      const responseJson = JSON.stringify(result);
      expect(responseJson).not.toContain('credentialsEncrypted');
      expect(responseJson).not.toContain('page-selection-secret');
      expect(responseJson).not.toContain('user-selection-secret');
      expect(responseJson).not.toContain('access_token');
      expect(harness.decryptSpy).not.toHaveBeenCalled();
      expect(
        harness.meta.subscribeFacebookPageToMessengerWebhooks,
      ).not.toHaveBeenCalled();
      expect(harness.channels.save).not.toHaveBeenCalled();
    });

    it.each([
      ['tenant', { tenantId: 'other-tenant' }],
      ['workspace', { workspaceId: 'other-workspace' }],
      ['owner', { userId: 'other-user' }],
      ['anonymous requester', { userId: null }],
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
      },
    );

    it.each([
      ['session_consumed', { status: 'completed' as const }],
      ['session_expired', { status: 'expired' as const }],
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

    it.each([
      ['missing array', undefined],
      ['non-array value', { pageId: '123' }],
      ['non-object asset', [null]],
      ['empty page id', [{ pageId: ' ', pageName: 'Page', tasks: [] }]],
      ['invalid page name', [{ pageId: '123', pageName: 1, tasks: [] }]],
      ['missing tasks', [{ pageId: '123', pageName: 'Page' }]],
      ['invalid tasks', [{ pageId: '123', pageName: 'Page', tasks: [7] }]],
    ])(
      'rejects %s as invalid_asset_payload',
      async (_case, selectableAssets) => {
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
      },
    );
  });

  describe('selection', () => {
    it('subscribes the Page and persists the Messenger channel contract', async () => {
      const harness = createHarness({ session: selectionSessionFixture() });

      const result = await harness.service.select(selectionInput());

      expect(result).toEqual({ channelId: 'new-channel-id' });
      expect(harness.transactionSessions.findOne).toHaveBeenCalledWith({
        where: {
          id: 'session-id',
          tenantId: 'tenant-id',
          workspaceId: 'workspace-id',
          provider: 'meta',
          channelType: 'facebook_messenger',
        },
        lock: { mode: 'pessimistic_write' },
      });
      expect(
        harness.meta.subscribeFacebookPageToMessengerWebhooks,
      ).toHaveBeenCalledWith({
        pageId: '123',
        pageAccessToken: 'page-selection-secret',
      });
      expect(
        harness.meta.subscribeFacebookPageToInstagramWebhooks,
      ).not.toHaveBeenCalled();
      expect(harness.manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        ['tenant-id:workspace-id', 'facebook_messenger:meta:123'],
      );

      const savedChannel = harness.channels.save.mock.calls[0][0];
      expect(savedChannel).toMatchObject({
        type: 'facebook_messenger',
        provider: 'meta',
        externalAccountId: '123',
        externalId: '123',
        externalPageId: '123',
        status: 'active',
        connectionStatus: 'connected',
        credentialVersion: 1,
        lifecycleVersion: 1,
        settings: { connectionHealth: 'ok' },
        metadata: expect.objectContaining({
          authorizationMethod: 'facebook_login',
          facebookPageId: '123',
          pageName: 'Selected Page',
          pageTasks: ['MESSAGING', 'ANALYZE'],
          tokenType: 'page_access_token',
          tokenExpiresAt: null,
          webhookSubscribedFields: [
            'messages',
            'message_deliveries',
            'message_reads',
            'message_reactions',
            'message_echoes',
          ],
          connectionSessionId: 'session-id',
        }),
      });
      expect(savedChannel.accessTokenEncrypted).not.toBe(
        'page-selection-secret',
      );
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
        }),
      });
      expect(harness.session.payload.credentialsEncrypted).toBeUndefined();
      expect(JSON.stringify(harness.session)).not.toContain(
        'page-selection-secret',
      );
    });

    it('rejects a Page id that was not offered by the session snapshot', async () => {
      const harness = createHarness({ session: selectionSessionFixture() });

      const exception = await selectionFailure(harness, {
        ...selectionInput(),
        pageId: '999',
      });

      expect(exception.message).toBe('asset_not_available');
      expect(harness.decryptSpy).not.toHaveBeenCalled();
      expect(
        harness.meta.subscribeFacebookPageToMessengerWebhooks,
      ).not.toHaveBeenCalled();
      expect(harness.channels.save).not.toHaveBeenCalled();
    });

    it('rejects a Page without the MESSAGING task before touching credentials', async () => {
      const harness = createHarness({ session: selectionSessionFixture() });

      const exception = await selectionFailure(harness, {
        ...selectionInput(),
        pageId: '456',
      });

      expect(exception.message).toBe('page_missing_messaging_access');
      expect(exception.message).not.toContain('page-selection-secret');
      expect(harness.decryptSpy).not.toHaveBeenCalled();
      expect(
        harness.meta.subscribeFacebookPageToMessengerWebhooks,
      ).not.toHaveBeenCalled();
      expect(harness.channels.save).not.toHaveBeenCalled();
    });

    it.each([
      ['tenant', { tenantId: 'other-tenant' }],
      ['workspace', { workspaceId: 'other-workspace' }],
      ['owner', { userId: 'other-user' }],
      ['anonymous requester', { userId: null }],
    ] as const)(
      'rejects a session from another %s',
      async (_scope, override) => {
        const harness = createHarness({ session: selectionSessionFixture() });

        const exception = await selectionFailure(harness, {
          ...selectionInput(),
          ...override,
        });

        expect(exception.message).toBe('invalid_session');
        expect(
          harness.meta.subscribeFacebookPageToMessengerWebhooks,
        ).not.toHaveBeenCalled();
        expect(harness.channels.save).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['session_expired', { expiresAt: new Date(Date.now() - 1) }],
      ['session_consumed', { status: 'completed' as const }],
      [
        'invalid_session',
        {
          metadata: {
            authorizationMethod: 'facebook_login',
            stage: 'oauth_started',
          },
        },
      ],
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

    it.each([
      ['missing encrypted credentials', undefined],
      ['malformed JSON', 'not-json'],
      [
        'missing selected Page credential',
        JSON.stringify({
          userAccessToken: 'user-selection-secret',
          pageCredentials: [
            { pageId: '999', pageAccessToken: 'other-page-secret' },
          ],
        }),
      ],
    ])('rejects %s defensively', async (_case, plaintext) => {
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

      expect(exception.message).toBe('invalid_credential_payload');
      expect(harness.channels.save).not.toHaveBeenCalled();
    });

    it('rejects credential decryption failure without leaking ciphertext', async () => {
      const harness = createHarness({ session: selectionSessionFixture() });
      jest.spyOn(harness.crypto, 'decrypt').mockImplementation(() => {
        throw new Error('decrypt failed with page-selection-secret');
      });

      const exception = await selectionFailure(harness);

      expect(exception.message).toBe('credential_decryption_failed');
      expect(exception.message).not.toContain('page-selection-secret');
      expect(harness.channels.save).not.toHaveBeenCalled();
    });

    it('never connects a channel when the Page subscription fails', async () => {
      const harness = createHarness({ session: selectionSessionFixture() });
      harness.meta.subscribeFacebookPageToMessengerWebhooks.mockRejectedValue(
        new Error(
          'provider leaked page-selection-secret and user-selection-secret',
        ),
      );

      const exception = await selectionFailure(harness);

      expect(exception.message).toBe('webhook_subscription_failed');
      expect(exception.message).not.toContain('page-selection-secret');
      expect(exception.message).not.toContain('user-selection-secret');
      expect(harness.channels.create).not.toHaveBeenCalled();
      expect(harness.channels.save).not.toHaveBeenCalled();
      expect(harness.session.status).toBe('pending');
      expect(harness.session.completedAt).toBeNull();
    });

    it('rolls back selection with a sanitized persistence failure', async () => {
      const harness = createHarness({ session: selectionSessionFixture() });
      harness.channels.save.mockRejectedValue(
        new Error('database failure included page-selection-secret'),
      );

      const exception = await selectionFailure(harness);

      expect(exception.message).toBe('channel_persistence_failed');
      expect(exception.message).not.toContain('page-selection-secret');
      expect(harness.session.status).toBe('pending');
      expect(harness.session.completedAt).toBeNull();
    });
  });

  describe('reconnect and coexistence', () => {
    it('upserts the same Page instead of duplicating the channel', async () => {
      const existing = messengerChannelFixture({
        credentialVersion: 4,
        lifecycleVersion: 2,
        status: 'inactive',
        connectionStatus: 'disconnected',
        disconnectedAt: new Date(),
        disconnectReason: 'token_revoked',
        settings: { routing: 'preserved', connectionHealth: 'stale' },
        metadata: { unrelatedAudit: 'preserved' },
      });
      const harness = createHarness({
        session: selectionSessionFixture(),
        storedChannels: [existing],
      });

      const result = await harness.service.select(selectionInput());

      expect(result).toEqual({ channelId: 'existing-messenger-channel-id' });
      expect(harness.channels.create).not.toHaveBeenCalled();
      expect(harness.channels.save).toHaveBeenCalledTimes(1);
      expect(harness.channels.save).toHaveBeenCalledWith(existing);
      expect(existing).toMatchObject({
        type: 'facebook_messenger',
        externalAccountId: '123',
        externalId: '123',
        externalPageId: '123',
        status: 'active',
        connectionStatus: 'connected',
        credentialVersion: 5,
        lifecycleVersion: 3,
        disconnectedAt: null,
        disconnectReason: null,
        settings: { routing: 'preserved', connectionHealth: 'ok' },
        metadata: expect.objectContaining({ unrelatedAudit: 'preserved' }),
      });
      expect(harness.crypto.decrypt(existing.accessTokenEncrypted)).toBe(
        'page-selection-secret',
      );
    });

    it('leaves an Instagram channel on the same Page untouched', async () => {
      const instagramChannel = messengerChannelFixture({
        id: 'instagram-channel-id',
        type: 'instagram',
        name: 'Instagram',
        externalAccountId: 'instagram-123',
        externalId: 'instagram-scoped-id',
        externalPageId: '123',
        accessTokenEncrypted: 'instagram-encrypted-token',
        credentialVersion: 9,
        metadata: { authorizationMethod: 'facebook_login' },
      });
      const snapshot = JSON.stringify(instagramChannel);
      const harness = createHarness({
        session: selectionSessionFixture(),
        storedChannels: [instagramChannel],
      });

      const result = await harness.service.select(selectionInput());

      expect(result).toEqual({ channelId: 'new-channel-id' });
      expect(harness.channels.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'facebook_messenger',
            provider: 'meta',
            externalAccountId: '123',
            tenantId: 'tenant-id',
            workspaceId: 'workspace-id',
          }),
        }),
      );
      expect(harness.channels.create).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(instagramChannel)).toBe(snapshot);
      expect(harness.channels.save).not.toHaveBeenCalledWith(instagramChannel);
    });

    it.each([
      ['tenant', { tenantId: 'other-tenant' }],
      ['workspace', { workspaceId: 'other-workspace' }],
    ] as const)(
      'never reuses a Messenger channel from another %s',
      async (_scope, override) => {
        const foreign = messengerChannelFixture(override);
        const harness = createHarness({
          session: selectionSessionFixture(),
          storedChannels: [foreign],
        });

        const result = await harness.service.select(selectionInput());

        expect(result).toEqual({ channelId: 'new-channel-id' });
        expect(harness.channels.create).toHaveBeenCalledTimes(1);
        expect(harness.channels.save).not.toHaveBeenCalledWith(foreign);
      },
    );

    it('ignores a soft-deleted Messenger channel for the same Page', async () => {
      const deleted = messengerChannelFixture({ deletedAt: new Date() });
      const harness = createHarness({
        session: selectionSessionFixture(),
        storedChannels: [deleted],
      });

      await expect(harness.service.select(selectionInput())).resolves.toEqual({
        channelId: 'new-channel-id',
      });
      expect(harness.channels.create).toHaveBeenCalledTimes(1);
    });
  });
});

function createHarness(
  options: {
    session?: InboxChannelConnectionSessionEntity | null;
    storedChannels?: InboxChannelEntity[];
    assets?: Array<{
      pageId: string;
      pageName: string;
      pageAccessToken: string;
      tasks: string[];
      instagramAccount: { accountId: string; username: string | null } | null;
    }>;
  } = {},
) {
  const session =
    options.session === undefined ? sessionFixture() : options.session;
  const matchesWhere = (
    entity: Record<string, unknown>,
    where: Record<string, unknown>,
  ) =>
    Object.entries(where).every(([property, value]) => {
      if (property === 'deletedAt') return entity.deletedAt == null;
      return entity[property] === value;
    });
  const findSession = jest.fn(
    async (query?: { where?: Record<string, unknown> }) => {
      if (!session) return null;
      return matchesWhere(
        session as unknown as Record<string, unknown>,
        query?.where ?? {},
      )
        ? session
        : null;
    },
  );
  const startSessions = {
    create: jest.fn((value) => ({ id: 'start-session-id', ...value })),
    findOne: findSession,
    save: jest.fn(async (value) => value),
  };
  const transactionSessions = {
    findOne: jest.fn(findSession),
    save: jest.fn(async (value) => value),
  };
  const storedChannels = options.storedChannels ?? [];
  const channels = {
    findOne: jest.fn(async (query?: { where?: Record<string, unknown> }) => {
      const where = query?.where ?? {};
      return (
        storedChannels.find((channel) =>
          matchesWhere(channel as unknown as Record<string, unknown>, where),
        ) ?? null
      );
    }),
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
    subscribeFacebookPageToMessengerWebhooks: jest.fn(async () => ({
      success: true as const,
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
            pageName: 'Page With Instagram',
            pageAccessToken: 'page-secret-1',
            tasks: ['MESSAGING', 'ANALYZE'],
            instagramAccount: {
              accountId: 'instagram-1',
              username: 'page.one',
            },
          },
          {
            pageId: 'page-2',
            pageName: 'Page Without Instagram',
            pageAccessToken: 'page-secret-2',
            tasks: ['MESSAGING'],
            instagramAccount: null,
          },
          {
            pageId: 'page-3',
            pageName: 'Page Without Messaging',
            pageAccessToken: 'page-secret-3',
            tasks: ['ANALYZE'],
            instagramAccount: null,
          },
        ],
    ),
  };
  const crypto = new SettingsCryptoService();
  const decryptSpy = jest.spyOn(crypto, 'decrypt');
  const service = new FacebookMessengerOAuthService(
    startSessions as unknown as Repository<InboxChannelConnectionSessionEntity>,
    dataSource as unknown as DataSource,
    meta as unknown as MetaGraphService,
    discovery as unknown as MetaAssetDiscoveryService,
    crypto,
    new FacebookMessengerChannelConnectionService(crypto),
  );

  return {
    service,
    session: session as InboxChannelConnectionSessionEntity,
    startSessions,
    transactionSessions,
    dataSource,
    channels,
    storedChannels,
    manager,
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
    channelType: 'facebook_messenger',
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
            { pageId: '123', pageAccessToken: 'page-selection-secret' },
            { pageId: '456', pageAccessToken: 'other-page-selection-secret' },
          ],
        }),
      ),
      selectableAssets: [
        {
          pageId: '123',
          pageName: 'Selected Page',
          tasks: ['MESSAGING', 'ANALYZE'],
        },
        {
          pageId: '456',
          pageName: 'Page Without Messaging',
          tasks: ['ANALYZE'],
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

function messengerChannelFixture(
  overrides: Partial<InboxChannelEntity> = {},
): InboxChannelEntity {
  return {
    id: 'existing-messenger-channel-id',
    tenantId: 'tenant-id',
    workspaceId: 'workspace-id',
    name: 'Messenger',
    type: 'facebook_messenger',
    status: 'active',
    connectionStatus: 'connected',
    lifecycleVersion: 1,
    credentialVersion: 1,
    provider: 'meta',
    externalId: '123',
    externalAccountId: '123',
    externalPhoneNumberId: null,
    externalPageId: '123',
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

function selectionInput(): Parameters<
  FacebookMessengerOAuthService['select']
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
  FacebookMessengerOAuthService['getSessionAssets']
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
    throw new Error('Expected Messenger session assets to fail.');
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
    throw new Error('Expected Messenger selection to fail.');
  } catch (error) {
    return error as BadRequestException;
  }
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function errorReason(redirect: string) {
  return new URL(redirect).searchParams.get('reason');
}
