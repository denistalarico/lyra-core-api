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
import { FacebookMessengerChannelHealthService } from './facebook-messenger-channel-health.service';

const REQUIRED_WEBHOOK_FIELDS = [
  'messages',
  'message_deliveries',
  'message_reads',
  'message_reactions',
  'message_echoes',
];

describe('FacebookMessengerChannelHealthService', () => {
  it('verifies the Page identity and webhook subscription, returning only a sanitized result', async () => {
    const harness = createHarness();

    const result = await harness.service.runHealthCheck(scopedInput);

    expect(harness.crypto.decrypt).toHaveBeenCalledWith('encrypted-secret');
    expect(harness.meta.getFacebookPageIdentity).toHaveBeenCalledWith({
      pageAccessToken: 'decrypted-secret',
    });
    expect(harness.meta.getFacebookPageWebhookSubscriptions).toHaveBeenCalledWith(
      { pageId: 'facebook-page-id', pageAccessToken: 'decrypted-secret' },
    );
    expect(result).toMatchObject({
      ok: true,
      channelId: 'messenger-channel-id',
      status: 'healthy',
      tokenValid: true,
      accountIdMatches: true,
      webhookSubscriptionHealthy: true,
      diagnosis: null,
      requiresReconnect: false,
      missingWebhookFields: [],
      pageName: 'Loja Centro',
    });
    expect(JSON.stringify(result)).not.toContain('decrypted-secret');
    expect(harness.repository.save).not.toHaveBeenCalled();
  });

  it.each(REQUIRED_WEBHOOK_FIELDS)(
    'returns unhealthy when the %s webhook field is missing',
    async (missingField) => {
      const harness = createHarness();
      harness.meta.getFacebookPageWebhookSubscriptions.mockResolvedValue({
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
    },
  );

  it('returns an unhealthy reconnect diagnosis when the app is not subscribed', async () => {
    const harness = createHarness();
    harness.meta.getFacebookPageWebhookSubscriptions.mockResolvedValue({
      appSubscribed: false,
      subscribedFields: [],
    });

    const result = await harness.service.runHealthCheck(scopedInput);

    expect(result).toMatchObject({
      ok: false,
      status: 'unhealthy',
      webhookSubscriptionHealthy: false,
      diagnosis: 'webhook_subscription_missing',
      requiresReconnect: true,
      missingWebhookFields: REQUIRED_WEBHOOK_FIELDS,
    });
  });

  it('requires a credential without calling Meta', async () => {
    const harness = createHarness({ accessTokenEncrypted: null });

    await expect(harness.service.runHealthCheck(scopedInput)).rejects.toThrow(
      new BadRequestException('Messenger channel credential is missing.'),
    );
    expect(harness.meta.getFacebookPageIdentity).not.toHaveBeenCalled();
  });

  it('requires the stored Page identity without calling Meta', async () => {
    const harness = createHarness({ externalPageId: null });

    await expect(harness.service.runHealthCheck(scopedInput)).rejects.toThrow(
      new BadRequestException(
        'Messenger channel Page identity is missing.',
      ),
    );
    expect(harness.meta.getFacebookPageIdentity).not.toHaveBeenCalled();
  });

  it('rejects disconnected channels without changing their status', async () => {
    const harness = createHarness({
      status: 'inactive',
      connectionStatus: 'disconnected',
    });

    await expect(harness.service.runHealthCheck(scopedInput)).rejects.toThrow(
      new BadRequestException('Messenger channel is not connected.'),
    );
    expect(harness.channel).toMatchObject({
      status: 'inactive',
      connectionStatus: 'disconnected',
    });
    expect(harness.repository.save).not.toHaveBeenCalled();
  });

  it('rejects a Page identity mismatch without leaking the credential', async () => {
    const harness = createHarness();
    harness.meta.getFacebookPageIdentity.mockResolvedValue({
      pageId: 'different-page-id',
      pageName: 'Outra loja',
    });

    const error = await harness.service
      .runHealthCheck(scopedInput)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect(String((error as Error).message)).not.toContain(
      'different-page-id',
    );
    expect(String((error as Error).message)).not.toContain('decrypted-secret');
  });

  it('sanitizes provider failures on the identity lookup', async () => {
    const harness = createHarness();
    harness.meta.getFacebookPageIdentity.mockRejectedValue(
      new Error('provider response included decrypted-secret'),
    );

    const error = await harness.service
      .runHealthCheck(scopedInput)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect(String((error as Error).message)).toBe(
      'Messenger did not accept the saved credential.',
    );
  });

  it('sanitizes webhook subscription lookup failures', async () => {
    const harness = createHarness();
    harness.meta.getFacebookPageWebhookSubscriptions.mockRejectedValue(
      new Error('provider response included decrypted-secret'),
    );

    const error = await harness.service
      .runHealthCheck(scopedInput)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadGatewayException);
    expect(String((error as Error).message)).toBe(
      'Messenger webhook subscription could not be verified.',
    );
    expect(JSON.stringify(error)).not.toContain('decrypted-secret');
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
      'Messenger channel credential could not be decrypted.',
    );
  });

  it('isolates lookup by tenant, workspace, channel type and provider', async () => {
    const harness = createHarness(null);

    await expect(harness.service.runHealthCheck(scopedInput)).rejects.toThrow(
      NotFoundException,
    );
    expect(harness.repository.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'messenger-channel-id',
        tenantId: 'tenant-id',
        workspaceId: 'workspace-id',
        type: 'facebook_messenger',
        provider: 'meta',
      }),
    });
  });
});

const scopedInput = {
  tenantId: 'tenant-id',
  workspaceId: 'workspace-id',
  channelId: 'messenger-channel-id',
};

function createHarness(overrides: Partial<InboxChannelEntity> | null = {}) {
  const channel =
    overrides === null
      ? null
      : ({
          id: 'messenger-channel-id',
          tenantId: 'tenant-id',
          workspaceId: 'workspace-id',
          name: 'Messenger — Loja Centro',
          type: 'facebook_messenger',
          provider: 'meta',
          status: 'active',
          connectionStatus: 'connected',
          externalAccountId: 'facebook-page-id',
          externalId: 'facebook-page-id',
          externalPageId: 'facebook-page-id',
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
    getFacebookPageIdentity: jest.fn(() =>
      Promise.resolve({
        pageId: 'facebook-page-id',
        pageName: 'Loja Centro',
      }),
    ),
    getFacebookPageWebhookSubscriptions: jest.fn(() =>
      Promise.resolve({
        appSubscribed: true,
        subscribedFields: REQUIRED_WEBHOOK_FIELDS,
      }),
    ),
  };
  const service = new FacebookMessengerChannelHealthService(
    repository as unknown as Repository<InboxChannelEntity>,
    crypto as unknown as SettingsCryptoService,
    meta as unknown as MetaGraphService,
  );

  return { service, channel, repository, crypto, meta };
}
