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
        where: [
          {
            type: 'instagram',
            provider: 'meta',
            externalAccountId: 'ig-account',
            status: 'active',
            connectionStatus: 'connected',
            deletedAt: IsNull(),
          },
          {
            type: 'instagram',
            provider: 'meta',
            externalId: 'ig-account',
            status: 'active',
            connectionStatus: 'connected',
            deletedAt: IsNull(),
          },
        ],
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

  describe('Facebook Messenger', () => {
    it('resolves exactly one connected active channel by canonical Page ID', async () => {
      const channel = {
        id: 'messenger-channel',
        tenantId: 'tenant',
        workspaceId: 'workspace',
      };
      const repository = { find: jest.fn().mockResolvedValue([channel]) };
      const service = new MetaChannelResolverService(repository as never);

      await expect(
        service.findFacebookMessengerChannelByPageId('page-1'),
      ).resolves.toBe(channel);
      expect(repository.find).toHaveBeenCalledWith({
        where: {
          type: 'facebook_messenger',
          provider: 'meta',
          externalAccountId: 'page-1',
          status: 'active',
          connectionStatus: 'connected',
          deletedAt: IsNull(),
        },
        take: 2,
      });
    });

    it('rejects a missing Page ID mapping', async () => {
      const repository = {
        find: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
      };
      const service = new MetaChannelResolverService(repository as never);

      await expect(
        service.findFacebookMessengerChannelByPageId('missing-page'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each(['disconnected', 'suspended', 'inactive'])(
      'reports a single %s channel as unavailable',
      async (state) => {
        const channel = {
          id: `messenger-${state}`,
          tenantId: 'tenant',
          workspaceId: 'workspace',
          status: state === 'inactive' ? 'inactive' : 'active',
          connectionStatus: state === 'inactive' ? 'connected' : state,
        };
        const repository = {
          find: jest
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([channel]),
        };
        const service = new MetaChannelResolverService(repository as never);

        await expect(
          service.findFacebookMessengerChannelByPageId('page-1'),
        ).rejects.toMatchObject({
          code: 'meta_channel_unavailable',
          channel,
        });
      },
    );

    it('rejects an ambiguous active Page ID mapping', async () => {
      const repository = {
        find: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
      };
      const service = new MetaChannelResolverService(repository as never);

      await expect(
        service.findFacebookMessengerChannelByPageId('ambiguous-page'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it.each(['instagram', 'facebook'])(
      'does not resolve a %s channel with the same Page ID',
      async (otherType) => {
        const otherChannel = {
          id: `${otherType}-channel`,
          type: otherType,
          provider: 'meta',
          externalAccountId: 'page-1',
        };
        const repository = {
          find: jest.fn(({ where }: { where: { type: string } }) =>
            Promise.resolve(
              where.type === otherChannel.type ? [otherChannel] : [],
            ),
          ),
        };
        const service = new MetaChannelResolverService(repository as never);

        await expect(
          service.findFacebookMessengerChannelByPageId('page-1'),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(repository.find).toHaveBeenCalledTimes(2);
        expect(repository.find).toHaveBeenNthCalledWith(2, {
          where: {
            type: 'facebook_messenger',
            provider: 'meta',
            externalAccountId: 'page-1',
            deletedAt: IsNull(),
          },
          take: 2,
        });
      },
    );
  });
});
