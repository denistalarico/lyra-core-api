/* eslint-disable @typescript-eslint/no-unsafe-assignment -- focused repository/service doubles */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { SettingsCryptoService } from '../../../../../common/crypto/settings-crypto.service';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import type { MetaGraphService } from '../../meta/services/meta-graph.service';
import { WhatsAppChannelHealthService } from './whatsapp-channel-health.service';

describe('WhatsAppChannelHealthService', () => {
  describe('runHealthCheck', () => {
    it('marks the channel needs_action without calling Meta when required fields are missing', async () => {
      const harness = createHarness({
        externalPhoneNumberId: null,
        accessTokenEncrypted: null,
      });

      const result = await harness.service.runHealthCheck(scopedInput);

      expect(harness.meta.getWhatsAppPhoneNumber).not.toHaveBeenCalled();
      expect(harness.repository.save).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        state: 'needs_action',
        connectionHealth: 'needs_action',
      });
      expect(harness.channel.status).toBe('draft');
      expect(harness.channel.settings?.missingRequirements).toEqual([
        'externalPhoneNumberId',
        'accessTokenEncrypted',
      ]);
    });

    it('activates the channel and stores the phone profile on a successful check', async () => {
      const harness = createHarness();

      const result = await harness.service.runHealthCheck(scopedInput);

      expect(harness.crypto.decrypt).toHaveBeenCalledWith('encrypted-secret');
      expect(harness.meta.getWhatsAppPhoneNumber).toHaveBeenCalledWith({
        phoneNumberId: 'phone-1',
        accessToken: 'decrypted-secret',
      });
      expect(harness.repository.save).toHaveBeenCalledTimes(1);
      expect(harness.channel.status).toBe('active');
      expect(harness.channel.metadata).toMatchObject({
        displayPhoneNumber: '+55 11 99999-0000',
        verifiedName: 'Loja Centro',
        qualityRating: 'GREEN',
      });
      expect(result).toMatchObject({
        state: 'connected',
        connectionHealth: 'connected',
        lastHealthCheckStatus: 'ok',
        displayPhoneNumber: '+55 11 99999-0000',
      });
    });

    it('marks the channel failed and rethrows when the Meta lookup rejects', async () => {
      const harness = createHarness();
      const providerError = new Error('token expired');
      harness.meta.getWhatsAppPhoneNumber.mockRejectedValue(providerError);

      await expect(
        harness.service.runHealthCheck(scopedInput),
      ).rejects.toThrow(providerError);

      expect(harness.repository.save).toHaveBeenCalledTimes(1);
      expect(harness.channel.status).toBe('draft');
      expect(harness.channel.settings?.connectionHealth).toBe('failed');
      expect(harness.channel.settings?.lastHealthCheckError).toBe(
        'token expired',
      );
    });

    it('rejects when the stored token cannot be decrypted, without calling Meta', async () => {
      const harness = createHarness();
      harness.crypto.decrypt.mockReturnValue(null);

      await expect(
        harness.service.runHealthCheck(scopedInput),
      ).rejects.toThrow(
        new BadRequestException('WhatsApp access token could not be decrypted.'),
      );
      expect(harness.meta.getWhatsAppPhoneNumber).not.toHaveBeenCalled();
      expect(harness.repository.save).not.toHaveBeenCalled();
    });

    it('isolates lookup by tenant, workspace, channel type and provider', async () => {
      const harness = createHarness(null);

      await expect(
        harness.service.runHealthCheck(scopedInput),
      ).rejects.toThrow(NotFoundException);
      expect(harness.repository.findOne).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: 'whatsapp-channel-id',
          tenantId: 'tenant-id',
          workspaceId: 'workspace-id',
          type: 'whatsapp',
          provider: 'meta',
        }),
      });
    });
  });

  describe('getHealth', () => {
    it('returns the mapped status without touching Meta or the repository save path', async () => {
      const harness = createHarness();

      const result = await harness.service.getHealth(scopedInput);

      expect(harness.meta.getWhatsAppPhoneNumber).not.toHaveBeenCalled();
      expect(harness.repository.save).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'whatsapp-channel-id' });
    });
  });

  describe('listStatus', () => {
    it('returns not_connected with an empty list when the workspace has no channels', async () => {
      const harness = createHarness();
      harness.findResult = [];

      const result = await harness.service.listStatus({
        tenantId: 'tenant-id',
        workspaceId: 'workspace-id',
      });

      expect(result).toEqual({
        state: 'not_connected',
        primaryChannel: null,
        channels: [],
      });
    });

    it('picks the connected channel as primary and reports the workspace as connected', async () => {
      const harness = createHarness();
      const connecting = {
        ...harness.channel,
        id: 'channel-connecting',
        status: 'draft',
        settings: { setupStep: 'awaiting_code' },
      } as InboxChannelEntity;
      const connected = {
        ...harness.channel,
        id: 'channel-connected',
        status: 'active',
        settings: { connectionHealth: 'connected' },
      } as InboxChannelEntity;
      harness.findResult = [connecting, connected];

      const result = await harness.service.listStatus({
        tenantId: 'tenant-id',
        workspaceId: 'workspace-id',
      });

      expect(result.state).toBe('connected');
      expect(result.primaryChannel?.id).toBe('channel-connected');
      expect(result.channels).toHaveLength(2);
    });

    it('reports failed when no channel is connected but one has failed', async () => {
      const harness = createHarness();
      const failed = {
        ...harness.channel,
        id: 'channel-failed',
        status: 'draft',
        settings: { connectionHealth: 'failed' },
      } as InboxChannelEntity;
      harness.findResult = [failed];

      const result = await harness.service.listStatus({
        tenantId: 'tenant-id',
        workspaceId: 'workspace-id',
      });

      expect(result.state).toBe('failed');
      expect(result.primaryChannel?.state).toBe('failed');
    });
  });
});

const scopedInput = {
  tenantId: 'tenant-id',
  workspaceId: 'workspace-id',
  channelId: 'whatsapp-channel-id',
};

function createHarness(overrides: Partial<InboxChannelEntity> | null = {}) {
  const channel =
    overrides === null
      ? null
      : ({
          id: 'whatsapp-channel-id',
          tenantId: 'tenant-id',
          workspaceId: 'workspace-id',
          name: 'WhatsApp — Loja Centro',
          type: 'whatsapp',
          provider: 'meta',
          status: 'draft',
          externalAccountId: 'waba-1',
          externalPhoneNumberId: 'phone-1',
          accessTokenEncrypted: 'encrypted-secret',
          settings: {},
          metadata: {},
          deletedAt: null,
          ...overrides,
        } as InboxChannelEntity);

  const state: {
    channel: InboxChannelEntity | null;
    findResult: InboxChannelEntity[];
  } = { channel, findResult: channel ? [channel] : [] };

  const repository = {
    findOne: jest.fn(() => Promise.resolve(state.channel)),
    find: jest.fn(() => Promise.resolve(state.findResult)),
    save: jest.fn((value: InboxChannelEntity) => Promise.resolve(value)),
  };
  const crypto = {
    decrypt: jest.fn((): string | null => 'decrypted-secret'),
  };
  const meta = {
    getWhatsAppPhoneNumber: jest.fn(() =>
      Promise.resolve({
        display_phone_number: '+55 11 99999-0000',
        verified_name: 'Loja Centro',
        quality_rating: 'GREEN',
        messaging_limit_tier: 'TIER_1K',
        platform_type: 'CLOUD_API',
        code_verification_status: 'VERIFIED',
      }),
    ),
  };
  const service = new WhatsAppChannelHealthService(
    repository as unknown as Repository<InboxChannelEntity>,
    crypto as unknown as SettingsCryptoService,
    meta as unknown as MetaGraphService,
  );

  return {
    service,
    repository,
    crypto,
    meta,
    state,
    get channel() {
      return state.channel!;
    },
    set findResult(value: InboxChannelEntity[]) {
      state.findResult = value;
    },
  };
}
