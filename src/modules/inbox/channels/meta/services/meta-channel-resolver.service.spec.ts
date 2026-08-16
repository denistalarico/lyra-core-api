import { ConflictException, NotFoundException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { MetaChannelResolverService } from './meta-channel-resolver.service';

describe('MetaChannelResolverService', () => {
  it('requires exactly one active provider key mapping', async () => {
    const repository = { find: jest.fn().mockResolvedValue([]) };
    const service = new MetaChannelResolverService(repository as never);
    await expect(
      service.findWhatsAppChannelByPhoneNumberId('phone-key'),
    ).rejects.toBeInstanceOf(NotFoundException);
    repository.find.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await expect(
      service.findWhatsAppChannelByPhoneNumberId('phone-key'),
    ).rejects.toBeInstanceOf(ConflictException);
    repository.find.mockResolvedValue([
      { id: 'only', tenantId: 'tenant', workspaceId: 'workspace' },
    ]);
    await expect(
      service.findWhatsAppChannelByPhoneNumberId('phone-key'),
    ).resolves.toMatchObject({ id: 'only' });
    expect(repository.find).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 2 }),
    );
  });

  describe('Instagram', () => {
    it('resolves exactly one connected active channel by external account ID', async () => {
      const channel = {
        id: 'instagram-channel',
        tenantId: 'tenant',
        workspaceId: 'workspace',
      };
      const repository = { find: jest.fn().mockResolvedValue([channel]) };
      const service = new MetaChannelResolverService(repository as never);

      await expect(
        service.findInstagramChannelByAccountId('ig-account'),
      ).resolves.toBe(channel);
      expect(repository.find).toHaveBeenCalledWith({
        where: {
          type: 'instagram',
          provider: 'meta',
          externalAccountId: 'ig-account',
          status: 'active',
          connectionStatus: 'connected',
          deletedAt: IsNull(),
        },
        take: 2,
      });
    });

    it('rejects a missing account mapping', async () => {
      const repository = {
        find: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
      };
      const service = new MetaChannelResolverService(repository as never);

      await expect(
        service.findInstagramChannelByAccountId('missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(['disconnected', 'suspended'])(
      'reports a single %s channel as unavailable',
      async (connectionStatus) => {
        const channel = {
          id: `instagram-${connectionStatus}`,
          tenantId: 'tenant',
          workspaceId: 'workspace',
          connectionStatus,
        };
        const repository = {
          find: jest
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([channel]),
        };
        const service = new MetaChannelResolverService(repository as never);

        await expect(
          service.findInstagramChannelByAccountId('ig-account'),
        ).rejects.toMatchObject({
          code: 'meta_channel_unavailable',
          channel,
        });
      },
    );

    it('rejects an ambiguous active account mapping', async () => {
      const repository = {
        find: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
      };
      const service = new MetaChannelResolverService(repository as never);

      await expect(
        service.findInstagramChannelByAccountId('ambiguous'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
