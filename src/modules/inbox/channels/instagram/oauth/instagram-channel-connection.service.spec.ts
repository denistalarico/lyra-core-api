/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- focused TypeORM repository doubles */
import type { EntityManager } from 'typeorm';
import type { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { InboxChannelConnectionSessionEntity } from '../../../entities/inbox-channel-connection-session.entity';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { InstagramChannelConnectionService } from './instagram-channel-connection.service';

describe('InstagramChannelConnectionService', () => {
  it('locks the canonical identities and creates the direct-login channel shape', async () => {
    const harness = createHarness();

    const channel = await harness.service.connect(harness.manager, {
      session: sessionFixture(),
      accountId: 'instagram-account-id',
      scopedId: 'instagram-scoped-id',
      username: 'talaricolabs',
      accessToken: 'instagram-secret',
      tokenType: 'bearer',
      tokenExpiresIn: 3_600,
      permissions: ['instagram_business_manage_messages'],
      authorizationMethod: 'instagram_login',
    });

    expect(harness.manager.query).toHaveBeenCalledTimes(2);
    expect(harness.channels.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.arrayContaining([
          expect.objectContaining({
            tenantId: 'tenant-id',
            workspaceId: 'workspace-id',
            externalAccountId: 'instagram-account-id',
          }),
          expect.objectContaining({ externalId: 'instagram-scoped-id' }),
        ]),
        lock: { mode: 'pessimistic_write' },
      }),
    );
    expect(channel).toMatchObject({
      id: 'new-channel-id',
      type: 'instagram',
      provider: 'meta',
      externalAccountId: 'instagram-account-id',
      externalId: 'instagram-scoped-id',
      credentialVersion: 1,
      lifecycleVersion: 1,
      metadata: expect.objectContaining({
        authorizationMethod: 'instagram_login',
        instagramScopedId: 'instagram-scoped-id',
      }),
    });
  });

  it('reuses and reconnects the same channel for Facebook Login without losing configuration', async () => {
    const existing = channelFixture({
      status: 'inactive',
      connectionStatus: 'disconnected',
      lifecycleVersion: 4,
      credentialVersion: 9,
      externalId: 'preserved-scoped-id',
      settings: { routing: 'preserved' },
      metadata: {
        authorizationMethod: 'instagram_login',
        auditFlag: 'preserved',
      },
      disconnectedAt: new Date(),
    });
    const harness = createHarness(existing);

    const channel = await harness.service.connect(harness.manager, {
      session: sessionFixture(),
      accountId: 'instagram-account-id',
      scopedId: null,
      username: 'current.username',
      accessToken: 'page-secret',
      tokenType: 'page_access_token',
      tokenExpiresIn: null,
      permissions: [],
      authorizationMethod: 'facebook_login',
      facebookPageId: 'facebook-page-id',
    });

    expect(harness.channels.create).not.toHaveBeenCalled();
    expect(channel).toBe(existing);
    expect(channel).toMatchObject({
      status: 'active',
      connectionStatus: 'connected',
      externalAccountId: 'instagram-account-id',
      externalId: 'preserved-scoped-id',
      externalPageId: 'facebook-page-id',
      lifecycleVersion: 5,
      credentialVersion: 10,
      settings: { routing: 'preserved', connectionHealth: 'ok' },
      metadata: expect.objectContaining({
        authorizationMethod: 'facebook_login',
        auditFlag: 'preserved',
        facebookPageId: 'facebook-page-id',
      }),
    });
    expect(channel.externalPageId).toBe('facebook-page-id');
    expect(channel.metadata.facebookPageId).toBe('facebook-page-id');
  });

  it('reuses a Facebook Login channel through direct login and clears only Facebook Page state', async () => {
    const settings = { routing: 'preserved', connectionHealth: 'stale' };
    const existing = channelFixture({
      lifecycleVersion: 4,
      credentialVersion: 9,
      externalId: 'preserved-scoped-id',
      externalPageId: 'old-facebook-page-id',
      settings,
      metadata: {
        authorizationMethod: 'facebook_login',
        facebookPageId: 'old-facebook-page-id',
        auditFlag: 'preserved',
      },
    });
    const harness = createHarness(existing);

    const channel = await harness.service.connect(harness.manager, {
      session: sessionFixture(),
      accountId: 'instagram-account-id',
      scopedId: 'current-scoped-id',
      username: 'current.username',
      accessToken: 'direct-secret',
      tokenType: 'bearer',
      tokenExpiresIn: 3_600,
      permissions: ['instagram_business_manage_messages'],
      authorizationMethod: 'instagram_login',
    });

    expect(harness.channels.create).not.toHaveBeenCalled();
    expect(harness.channels.save).toHaveBeenCalledTimes(1);
    expect(channel).toBe(existing);
    expect(channel).toMatchObject({
      externalAccountId: 'instagram-account-id',
      externalId: 'current-scoped-id',
      externalPageId: null,
      lifecycleVersion: 4,
      credentialVersion: 10,
      settings: { routing: 'preserved', connectionHealth: 'ok' },
      metadata: expect.objectContaining({
        authorizationMethod: 'instagram_login',
        auditFlag: 'preserved',
      }),
    });
    expect(channel.metadata).not.toHaveProperty('facebookPageId');
    expect(settings).toEqual({
      routing: 'preserved',
      connectionHealth: 'stale',
    });
  });
});

function createHarness(existingChannel: InboxChannelEntity | null = null) {
  const channels = {
    findOne: jest.fn().mockResolvedValue(existingChannel),
    create: jest.fn((value) => ({ ...value })),
    save: jest.fn(async (value) => {
      if (!value.id) value.id = 'new-channel-id';
      return value;
    }),
  };
  const manager = {
    query: jest.fn().mockResolvedValue(undefined),
    getRepository: jest.fn(() => channels),
  } as unknown as EntityManager & { query: jest.Mock };
  const crypto = {
    encrypt: jest.fn((value: string) => `encrypted:${value}`),
  };
  const service = new InstagramChannelConnectionService(
    crypto as unknown as SettingsCryptoService,
  );

  return { service, manager, channels, crypto };
}

function sessionFixture(): InboxChannelConnectionSessionEntity {
  return {
    id: 'session-id',
    tenantId: 'tenant-id',
    workspaceId: 'workspace-id',
  } as InboxChannelConnectionSessionEntity;
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
    externalAccountId: 'instagram-account-id',
    externalPhoneNumberId: null,
    externalPageId: null,
    accessTokenEncrypted: 'old-encrypted-token',
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
