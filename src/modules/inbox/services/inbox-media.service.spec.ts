import { NotFoundException } from '@nestjs/common';
import { InboxMediaService } from './inbox-media.service';

describe('InboxMediaService workspace isolation', () => {
  it('denies an asset ID outside the active tenant/workspace', async () => {
    const repository = { findOne: jest.fn().mockResolvedValue(null) };
    const service = new InboxMediaService(
      repository as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.getAuthorizedAsset(
        { tenantId: 'tenant-a', workspaceId: 'workspace-a' } as never,
        'asset-from-b',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.findOne).toHaveBeenCalledWith({
      where: {
        id: 'asset-from-b',
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
      },
    });
  });

  it('streams an available original independently of derivative state', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'asset',
        status: 'available',
        objectKey: 'private/key',
        channelId: 'channel',
      }),
    };
    const files = {
      getPrivateAsset: jest.fn().mockResolvedValue({
        body: {},
        contentType: 'audio/ogg',
        cacheControl: 'private, no-store',
      }),
    };
    const channels = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'channel', metadata: { operatingMode: 'agency' } }),
    };
    const service = new InboxMediaService(
      repository as never,
      channels as never,
      files as never,
    );
    await expect(
      service.getAuthorizedAsset(
        { tenantId: 'tenant', workspaceId: 'workspace' } as never,
        'asset',
      ),
    ).resolves.toMatchObject({
      asset: { status: 'available' },
      file: { contentType: 'audio/ogg' },
    });
  });

  it('denies media from another managed client in the same agency workspace', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'asset',
        status: 'available',
        objectKey: 'private/key',
        channelId: 'channel-b',
      }),
    };
    const channels = {
      findOne: jest.fn().mockResolvedValue({
        id: 'channel-b',
        metadata: { clientId: 'client-b' },
      }),
    };
    const service = new InboxMediaService(
      repository as never,
      channels as never,
      {} as never,
    );
    await expect(
      service.getAuthorizedAsset(
        {
          tenantId: 'tenant',
          workspaceId: 'workspace',
          managedContext: { operatingMode: 'client', clientId: 'client-a' },
        } as never,
        'asset',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
