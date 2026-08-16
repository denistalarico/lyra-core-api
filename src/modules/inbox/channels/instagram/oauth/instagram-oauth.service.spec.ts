/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- Jest/TypeORM test doubles intentionally expose partial dynamic repository shapes. */
import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import type { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { InboxChannelConnectionSessionEntity } from '../../../entities/inbox-channel-connection-session.entity';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import type { MetaGraphService } from '../../meta/services/meta-graph.service';
import { InstagramOAuthService } from './instagram-oauth.service';

describe('InstagramOAuthService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      META_INSTAGRAM_OAUTH_CALLBACK_URL:
        'https://api.example.com/api/inbox/channels/instagram/oauth/callback',
      LEADFLOW_FRONTEND_URL: 'https://leadflow.example.com',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('creates a short-lived session and returns only a safe authorization URL', async () => {
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
      'https://www.instagram.com/oauth/authorize',
    );
    expect(firstUrl.searchParams.get('client_id')).toBe('instagram-app-id');
    expect(firstUrl.searchParams.get('redirect_uri')).toBe(
      process.env.META_INSTAGRAM_OAUTH_CALLBACK_URL,
    );
    expect(firstUrl.searchParams.get('scope')).toBe(
      'instagram_business_basic,instagram_business_manage_messages',
    );
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
      metadata: expect.objectContaining({
        authorizationMethod: 'instagram_login',
        stateStorage: 'sha256',
        clientId: 'client-id',
      }),
    });
    expect(first.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      15 * 60 * 1000,
    );
    expect(first).not.toHaveProperty('sessionId');
    expect(JSON.stringify(first)).not.toContain('accessToken');
  });

  it('creates and connects a new channel only after identity confirmation', async () => {
    const harness = createHarness();
    const redirect = await harness.service.handleCallback({
      state: 'valid-state',
      code: 'authorization-code',
    });

    expect(redirect).toBe(
      'https://leadflow.example.com/leadflow/inbox/settings?instagram=connected',
    );
    expect(harness.meta.exchangeInstagramCode).toHaveBeenCalledWith({
      code: 'authorization-code',
      redirectUri: process.env.META_INSTAGRAM_OAUTH_CALLBACK_URL,
    });
    expect(harness.meta.exchangeInstagramLongLivedToken).toHaveBeenCalledWith(
      'short-lived-secret',
    );
    expect(harness.meta.getInstagramAuthorizedAccount).toHaveBeenCalledWith(
      'long-lived-secret',
    );
    expect(harness.transactionSessions.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          state: hash('valid-state'),
          provider: 'meta',
          channelType: 'instagram',
        },
        lock: { mode: 'pessimistic_write' },
      }),
    );
    expect(harness.manager.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      ['tenant-id:workspace-id', 'instagram:meta:17841400000000000'],
    );

    const savedChannel = harness.channels.save.mock.calls[0][0];
    expect(savedChannel).toMatchObject({
      id: 'new-channel-id',
      tenantId: 'tenant-id',
      workspaceId: 'workspace-id',
      name: 'talaricolabs',
      type: 'instagram',
      provider: 'meta',
      externalAccountId: '17841400000000000',
      status: 'active',
      connectionStatus: 'connected',
      credentialVersion: 1,
      lifecycleVersion: 1,
      aiEnabled: false,
      accessTokenEncrypted: 'encrypted-long-lived-token',
      disconnectedAt: null,
      disconnectedBy: null,
      disconnectReason: null,
      credentialRemovedAt: null,
      metadata: expect.objectContaining({
        authorizationMethod: 'instagram_login',
        username: 'talaricolabs',
      }),
    });
    expect(harness.crypto.encrypt).toHaveBeenCalledWith('long-lived-secret');
    expect(JSON.stringify(savedChannel)).not.toContain('long-lived-secret');
    expect(JSON.stringify(savedChannel)).not.toContain('short-lived-secret');
    expect(harness.session.status).toBe('completed');
    expect(harness.session.code).toBeNull();
    expect(harness.session.completedAt).toBeInstanceOf(Date);
    expect(harness.channels.save.mock.invocationCallOrder[0]).toBeLessThan(
      harness.transactionSessions.save.mock.invocationCallOrder[0],
    );
  });

  it('reconnects the scoped existing channel without duplicating or losing configuration', async () => {
    const existing = channelFixture({
      id: 'existing-channel-id',
      name: 'Nome personalizado',
      status: 'inactive',
      connectionStatus: 'disconnected',
      credentialVersion: 7,
      lifecycleVersion: 3,
      accessTokenEncrypted: 'old-encrypted-token',
      defaultAssignedUserId: 'assigned-user-id',
      defaultAgentId: 'agent-id',
      defaultPipelineId: 'pipeline-id',
      aiEnabled: true,
      settings: { debounceSeconds: 12, customSetting: true },
      metadata: { customMetadata: 'keep-me' },
      disconnectedAt: new Date(),
      disconnectedBy: 'disconnect-user-id',
      disconnectReason: 'credential_revoked',
      credentialRemovedAt: new Date(),
    });
    const harness = createHarness({ existingChannel: existing });

    await harness.service.handleCallback({
      state: 'valid-state',
      code: 'authorization-code',
    });

    expect(harness.channels.create).not.toHaveBeenCalled();
    expect(harness.channels.save).toHaveBeenCalledTimes(1);
    expect(existing).toMatchObject({
      id: 'existing-channel-id',
      name: 'Nome personalizado',
      credentialVersion: 8,
      lifecycleVersion: 4,
      status: 'active',
      connectionStatus: 'connected',
      accessTokenEncrypted: 'encrypted-long-lived-token',
      defaultAssignedUserId: 'assigned-user-id',
      defaultAgentId: 'agent-id',
      defaultPipelineId: 'pipeline-id',
      aiEnabled: true,
      settings: {
        debounceSeconds: 12,
        customSetting: true,
        connectionHealth: 'ok',
      },
      metadata: expect.objectContaining({
        customMetadata: 'keep-me',
        authorizationMethod: 'instagram_login',
        username: 'talaricolabs',
      }),
      disconnectedAt: null,
      disconnectedBy: null,
      disconnectReason: null,
      credentialRemovedAt: null,
    });
  });

  it('rejects an unknown state without exchanging a token', async () => {
    const harness = createHarness({ session: null });

    const redirect = await harness.service.handleCallback({
      state: 'unknown-state',
      code: 'authorization-code',
    });

    expect(errorReason(redirect)).toBe('invalid_state');
    expect(new URL(redirect).pathname).toBe('/leadflow/inbox/settings');
    expect(new URL(redirect).searchParams.get('instagram')).toBe('error');
    expect(harness.meta.exchangeInstagramCode).not.toHaveBeenCalled();
  });

  it('expires a stale session and does not exchange a token', async () => {
    const session = sessionFixture({ expiresAt: new Date(Date.now() - 1) });
    const harness = createHarness({ session });

    const redirect = await harness.service.handleCallback({
      state: 'valid-state',
      code: 'authorization-code',
    });

    expect(errorReason(redirect)).toBe('session_expired');
    expect(session.status).toBe('expired');
    expect(session.errorMessage).toBe('session_expired');
    expect(harness.meta.exchangeInstagramCode).not.toHaveBeenCalled();
  });

  it('rejects an already consumed session without repeating mutations', async () => {
    const session = sessionFixture({ status: 'completed' });
    const harness = createHarness({ session });

    const redirect = await harness.service.handleCallback({
      state: 'valid-state',
      code: 'authorization-code',
    });

    expect(errorReason(redirect)).toBe('session_consumed');
    expect(harness.meta.exchangeInstagramCode).not.toHaveBeenCalled();
    expect(harness.channels.save).not.toHaveBeenCalled();
  });

  it('stores only a sanitized code when Instagram returns an OAuth error', async () => {
    const harness = createHarness();

    const redirect = await harness.service.handleCallback({
      state: 'valid-state',
      error: 'access_denied',
      errorReason: 'user_denied',
    });

    expect(errorReason(redirect)).toBe('oauth_denied');
    expect(harness.session.status).toBe('failed');
    expect(harness.session.errorMessage).toBe('oauth_denied');
    expect(JSON.stringify(harness.session)).not.toContain('user_denied');
  });

  it.each([
    ['token_exchange_failed', 'exchangeInstagramCode'],
    ['long_lived_token_exchange_failed', 'exchangeInstagramLongLivedToken'],
    ['identity_lookup_failed', 'getInstagramAuthorizedAccount'],
  ] as const)('sanitizes %s', async (reason, failingMethod) => {
    const harness = createHarness();
    harness.meta[failingMethod].mockRejectedValue(
      new BadRequestException('provider returned long-lived-secret'),
    );

    const redirect = await harness.service.handleCallback({
      state: 'valid-state',
      code: 'authorization-code',
    });

    expect(errorReason(redirect)).toBe(reason);
    expect(redirect).not.toContain('long-lived-secret');
    expect(harness.session.status).toBe('failed');
    expect(harness.session.errorMessage).toBe(reason);
  });

  it('never derives tenant or workspace from callback query values', async () => {
    const harness = createHarness();

    await harness.service.handleCallback({
      state: 'valid-state',
      code: 'authorization-code',
    });

    expect(harness.channels.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: harness.session.tenantId,
          workspaceId: harness.session.workspaceId,
        }),
      }),
    );
  });
});

function createHarness(
  options: {
    session?: InboxChannelConnectionSessionEntity | null;
    existingChannel?: InboxChannelEntity | null;
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
    getInstagramLoginAppId: jest.fn(() => 'instagram-app-id'),
    getInstagramLoginConfig: jest.fn(() => ({ appId: 'instagram-app-id' })),
    exchangeInstagramCode: jest.fn(async () => ({
      accessToken: 'short-lived-secret',
      userId: 'app-scoped-user-id',
      permissions: [
        'instagram_business_basic',
        'instagram_business_manage_messages',
      ],
    })),
    exchangeInstagramLongLivedToken: jest.fn(async () => ({
      accessToken: 'long-lived-secret',
      tokenType: 'bearer',
      expiresIn: 5_183_944,
    })),
    getInstagramAuthorizedAccount: jest.fn(async () => ({
      accountId: '17841400000000000',
      username: 'talaricolabs',
    })),
  };
  const crypto = {
    encrypt: jest.fn(() => 'encrypted-long-lived-token'),
  };
  const service = new InstagramOAuthService(
    startSessions as unknown as Repository<InboxChannelConnectionSessionEntity>,
    dataSource as unknown as DataSource,
    meta as unknown as MetaGraphService,
    crypto as unknown as SettingsCryptoService,
  );

  return {
    service,
    session: session as InboxChannelConnectionSessionEntity,
    startSessions,
    transactionSessions,
    channels,
    manager: manager as unknown as EntityManager & {
      query: jest.Mock;
    },
    meta,
    crypto,
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
    metadata: { authorizationMethod: 'instagram_login' },
    expiresAt: new Date(Date.now() + 60_000),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
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
    externalAccountId: '17841400000000000',
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

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function errorReason(redirect: string) {
  return new URL(redirect).searchParams.get('reason');
}
