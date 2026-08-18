/* eslint-disable @typescript-eslint/no-unsafe-assignment -- focused repository/service doubles */
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import type { MetaGraphService } from '../../meta/services/meta-graph.service';
import { InstagramChannelHealthService } from './instagram-channel-health.service';

const REQUIRED_WEBHOOK_FIELDS = [
  'messages',
  'messaging_postbacks',
  'message_reactions',
  'messaging_seen',
];

describe('InstagramChannelHealthService', () => {
  it('verifies the saved identity and returns only a sanitized result', async () => {
    const harness = createHarness();

    const result = await harness.service.runHealthCheck(scopedInput);

    expect(harness.crypto.decrypt).toHaveBeenCalledWith('encrypted-secret');
    expect(harness.meta.getInstagramAuthorizedAccount).toHaveBeenCalledWith(
      'decrypted-secret',
    );
    expect(
      harness.meta.getInstagramAccountWebhookSubscriptions,
    ).toHaveBeenCalledWith({
      igUserId: '17841400000000000',
      accessToken: 'decrypted-secret',
    });
    expect(result).toMatchObject({
      ok: true,
      channelId: 'instagram-channel-id',
      status: 'healthy',
      tokenValid: true,
      accountIdMatches: true,
      webhookSubscriptionHealthy: true,
      diagnosis: null,
      requiresReconnect: false,
      missingWebhookFields: [],
      username: 'talaricolabs',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(harness.repository.save).not.toHaveBeenCalled();
  });

  it('checks Facebook Login identity and webhooks through the selected Page', async () => {
    const harness = createHarness({
      externalPageId: 'facebook-page-id',
      metadata: { authorizationMethod: 'facebook_login' },
    });

    const result = await harness.service.runHealthCheck(scopedInput);

    expect(harness.meta.getFacebookPageInstagramAccount).toHaveBeenCalledWith({
      pageId: 'facebook-page-id',
      pageAccessToken: 'decrypted-secret',
    });
    expect(
      harness.meta.getFacebookPageWebhookSubscriptions,
    ).toHaveBeenCalledWith({
      pageId: 'facebook-page-id',
      pageAccessToken: 'decrypted-secret',
    });
    expect(harness.meta.getInstagramAuthorizedAccount).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      accountIdMatches: true,
      webhookSubscriptionHealthy: true,
      username: 'talaricolabs',
    });
    expect(JSON.stringify(result)).not.toContain('decrypted-secret');
  });

  it('accepts the additional scoped identifier when resolving channel identity', async () => {
    const harness = createHarness({
      externalAccountId: 'different-primary-id',
    });

    const result = await harness.service.runHealthCheck(scopedInput);

    expect(result).toMatchObject({
      ok: true,
      status: 'healthy',
      tokenValid: true,
      accountIdMatches: true,
      webhookSubscriptionHealthy: true,
      diagnosis: null,
      requiresReconnect: false,
    });
    expect(harness.repository.save).not.toHaveBeenCalled();
  });

  it('returns an unhealthy reconnect diagnosis when the app is not subscribed', async () => {
    const harness = createHarness();
    harness.meta.getInstagramAccountWebhookSubscriptions.mockResolvedValue({
      appSubscribed: false,
      subscribedFields: [],
    });

    const result = await harness.service.runHealthCheck(scopedInput);

    expect(result).toMatchObject({
      ok: false,
      status: 'unhealthy',
      tokenValid: true,
      accountIdMatches: true,
      webhookSubscriptionHealthy: false,
      diagnosis: 'webhook_subscription_missing',
      requiresReconnect: true,
      missingWebhookFields: REQUIRED_WEBHOOK_FIELDS,
    });
    expect(harness.repository.save).not.toHaveBeenCalled();
  });

  it.each(REQUIRED_WEBHOOK_FIELDS)(
    'returns unhealthy when the %s webhook field is missing',
    async (missingField) => {
      const harness = createHarness();
      harness.meta.getInstagramAccountWebhookSubscriptions.mockResolvedValue({
        appSubscribed: true,
        subscribedFields: REQUIRED_WEBHOOK_FIELDS.filter(
          (field) => field !== missingField,
        ),
      });

      const result = await harness.service.runHealthCheck(scopedInput);

      expect(result).toMatchObject({
        ok: false,
        status: 'unhealthy',
        webhookSubscriptionHealthy: false,
        diagnosis: 'webhook_subscription_incomplete',
        requiresReconnect: true,
        missingWebhookFields: [missingField],
      });
      expect(harness.repository.save).not.toHaveBeenCalled();
    },
  );

  it('requires a credential without calling Meta', async () => {
    const harness = createHarness({ accessTokenEncrypted: null });

    await expect(harness.service.runHealthCheck(scopedInput)).rejects.toThrow(
      new BadRequestException('Instagram channel credential is missing.'),
    );
    expect(harness.meta.getInstagramAuthorizedAccount).not.toHaveBeenCalled();
  });

  it('rejects disconnected channels without changing their status', async () => {
    const harness = createHarness({
      status: 'inactive',
      connectionStatus: 'disconnected',
    });

    await expect(harness.service.runHealthCheck(scopedInput)).rejects.toThrow(
      new BadRequestException('Instagram channel is not connected.'),
    );
    expect(harness.channel).toMatchObject({
      status: 'inactive',
      connectionStatus: 'disconnected',
    });
    expect(harness.repository.save).not.toHaveBeenCalled();
  });

  it('rejects an identity mismatch without leaking either credential', async () => {
    const harness = createHarness();
    harness.meta.getInstagramAuthorizedAccount.mockResolvedValue({
      accountId: 'different-account-id',
      scopedId: 'different-scoped-id',
      username: 'other-account',
    });

    const error = await harness.service
      .runHealthCheck(scopedInput)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect(String((error as Error).message)).not.toContain(
      'different-account-id',
    );
    expect(String((error as Error).message)).not.toContain('decrypted-secret');
  });

  it('sanitizes provider failures', async () => {
    const harness = createHarness();
    harness.meta.getInstagramAuthorizedAccount.mockRejectedValue(
      new Error('provider response included decrypted-secret'),
    );

    const error = await harness.service
      .runHealthCheck(scopedInput)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect(String((error as Error).message)).toBe(
      'Instagram did not accept the saved credential.',
    );
  });

  it('sanitizes webhook subscription lookup failures', async () => {
    const harness = createHarness();
    harness.meta.getInstagramAccountWebhookSubscriptions.mockRejectedValue(
      new Error('provider response included decrypted-secret'),
    );

    const error = await harness.service
      .runHealthCheck(scopedInput)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect(String((error as Error).message)).toBe(
      'Instagram webhook subscription could not be verified.',
    );
    expect(JSON.stringify(error)).not.toContain('decrypted-secret');
    expect(harness.repository.save).not.toHaveBeenCalled();
  });

  it('sanitizes credential decryption failures', async () => {
    const harness = createHarness();
    harness.crypto.decrypt.mockImplementation(() => {
      throw new Error('cipher payload encrypted-secret is corrupt');
    });

    const error = await harness.service
      .runHealthCheck(scopedInput)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(String((error as Error).message)).toBe(
      'Instagram channel credential could not be decrypted.',
    );
  });

  it('isolates lookup by tenant, workspace, channel type and provider', async () => {
    const harness = createHarness(null);

    await expect(harness.service.runHealthCheck(scopedInput)).rejects.toThrow(
      NotFoundException,
    );
    expect(harness.repository.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'instagram-channel-id',
        tenantId: 'tenant-id',
        workspaceId: 'workspace-id',
        type: 'instagram',
        provider: 'meta',
      }),
    });
  });
});

const scopedInput = {
  tenantId: 'tenant-id',
  workspaceId: 'workspace-id',
  channelId: 'instagram-channel-id',
};

function createHarness(overrides: Partial<InboxChannelEntity> | null = {}) {
  const channel =
    overrides === null
      ? null
      : ({
          id: 'instagram-channel-id',
          tenantId: 'tenant-id',
          workspaceId: 'workspace-id',
          name: 'Instagram — Loja Centro',
          type: 'instagram',
          provider: 'meta',
          status: 'active',
          connectionStatus: 'connected',
          externalAccountId: '17841400000000000',
          externalId: '27561859610089550',
          accessTokenEncrypted: 'encrypted-secret',
          deletedAt: null,
          ...overrides,
        } as InboxChannelEntity);
  const repository = {
    findOne: jest.fn(() => Promise.resolve(channel)),
    save: jest.fn(),
  };
  const crypto = {
    decrypt: jest.fn(() => 'decrypted-secret'),
  };
  const meta = {
    getInstagramAuthorizedAccount: jest.fn(() =>
      Promise.resolve({
        accountId: '17841400000000000',
        scopedId: '27561859610089550',
        username: 'talaricolabs',
      }),
    ),
    getInstagramAccountWebhookSubscriptions: jest.fn(() =>
      Promise.resolve({
        appSubscribed: true,
        subscribedFields: REQUIRED_WEBHOOK_FIELDS,
      }),
    ),
    getFacebookPageInstagramAccount: jest.fn(() =>
      Promise.resolve({
        accountId: '17841400000000000',
        username: 'talaricolabs',
      }),
    ),
    getFacebookPageWebhookSubscriptions: jest.fn(() =>
      Promise.resolve({
        appSubscribed: true,
        subscribedFields: REQUIRED_WEBHOOK_FIELDS,
      }),
    ),
  };
  const service = new InstagramChannelHealthService(
    repository as unknown as Repository<InboxChannelEntity>,
    crypto as unknown as SettingsCryptoService,
    meta as unknown as MetaGraphService,
  );

  return { service, channel, repository, crypto, meta };
}
