import { ConflictException, NotFoundException } from '@nestjs/common';
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
});
