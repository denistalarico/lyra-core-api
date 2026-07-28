import { ConflictException } from '@nestjs/common';
import {
  AdminIdentityGateway,
  type AdminIdentityRecord,
} from '../contracts/admin-identity.gateway';
import { AdminIdentityService } from './admin-identity.service';

const candidate: AdminIdentityRecord = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  email: 'owner@example.com',
  displayName: 'Owner',
  status: 'active',
  passwordConfigured: true,
  twoFactorEnabled: true,
  twoFactorMethod: 'authenticator',
};

describe('AdminIdentityService', () => {
  it('does not silently select an ambiguous identity', async () => {
    const findCandidatesByEmail = jest
      .fn()
      .mockResolvedValue([
        candidate,
        { ...candidate, tenantId: 'tenant-2', userId: 'user-2' },
      ]);
    const gateway = {
      findCandidatesByEmail,
    } as unknown as AdminIdentityGateway;
    const service = new AdminIdentityService(gateway);

    await expect(
      service.resolveUniqueCandidateByEmail('OWNER@example.com'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(findCandidatesByEmail).toHaveBeenCalledWith('owner@example.com');
  });
});
