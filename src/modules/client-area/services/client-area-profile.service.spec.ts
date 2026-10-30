jest.mock('../../../common/files/files.service', () => ({
  FilesService: class FilesService {},
}));

import { ClientAreaProfileService } from './client-area-profile.service';

describe('ClientAreaProfileService', () => {
  const identity = {
    tenantId: '10000000-0000-4000-8000-000000000001',
    userId: '10000000-0000-4000-8000-000000000002',
    sessionId: '10000000-0000-4000-8000-000000000003',
    email: 'ana@example.test',
  };

  it('projects the authenticated avatar path and session email', async () => {
    const profiles = {
      findOne: jest.fn().mockResolvedValue({
        displayName: 'Ana Cliente',
        email: 'stale@example.test',
        jobTitle: 'Diretora',
        phone: '+5511999999999',
        avatarAssetKey: 'tenants/t/users/u/avatar.webp',
        updatedAt: new Date('2026-10-29T12:00:00.000Z'),
      }),
    };
    const service = new ClientAreaProfileService(
      profiles as never,
      {} as never,
    );
    await expect(service.get(identity)).resolves.toEqual({
      displayName: 'Ana Cliente',
      jobTitle: 'Diretora',
      phone: '+5511999999999',
      email: identity.email,
      avatarUrl: '/client-area/me/profile/avatar?v=1793275200000',
    });
  });

  it('reuses the Agency asset pipeline and persists the same user_profile row', async () => {
    const profiles = {
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    const files = {
      uploadImageAsset: jest.fn().mockResolvedValue({
        url: '/files/avatar.webp',
        path: 'tenants/t/users/u/avatar.webp',
      }),
    };
    const service = new ClientAreaProfileService(
      profiles as never,
      files as never,
    );
    const file = { mimetype: 'image/png' } as Express.Multer.File;
    await service.uploadAvatar(identity, file);
    expect(files.uploadImageAsset).toHaveBeenCalledWith(expect.objectContaining({ file, maxDimension: 512 }));
    expect(profiles.upsert).toHaveBeenCalledWith(expect.objectContaining({ tenantId: identity.tenantId, userId: identity.userId, avatarAssetKey: 'tenants/t/users/u/avatar.webp' }), ['tenantId', 'userId']);
  });
});
