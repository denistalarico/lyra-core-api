import type { AdminIdentityRecord } from '../contracts/admin-identity.gateway';
import { AgencyAdminIdentityAdapter } from './agency-admin-identity.adapter';
import { CompositeAdminIdentityGateway } from './composite-admin-identity.gateway';
import { PlatformAdminIdentityAdapter } from './platform-admin-identity.adapter';

const agencyIdentity: AdminIdentityRecord = {
  source: 'agency',
  reference: { source: 'agency', tenantId: 'tenant', userId: 'user' },
  subjectId: 'user',
  tenantId: 'tenant',
  userId: 'user',
  email: 'same@example.com',
  displayName: 'Agency',
  status: 'active',
  passwordConfigured: true,
  twoFactorEnabled: true,
  twoFactorMethod: 'authenticator',
};
const platformIdentity: AdminIdentityRecord = {
  source: 'platform_admin',
  reference: { source: 'platform_admin', identityId: 'identity' },
  subjectId: 'identity',
  email: 'same@example.com',
  displayName: 'Internal',
  status: 'active',
  passwordConfigured: true,
  twoFactorEnabled: false,
  twoFactorMethod: 'authenticator',
};

describe('CompositeAdminIdentityGateway', () => {
  it('resolves each reference through its isolated adapter', async () => {
    const agency = {
      findByReference: jest.fn().mockResolvedValue(agencyIdentity),
    };
    const platform = {
      findByReference: jest.fn().mockResolvedValue(platformIdentity),
    };
    const gateway = new CompositeAdminIdentityGateway(
      agency as unknown as AgencyAdminIdentityAdapter,
      platform as unknown as PlatformAdminIdentityAdapter,
    );

    await expect(
      gateway.findByReference({
        source: 'agency',
        tenantId: 'tenant',
        userId: 'user',
      }),
    ).resolves.toBe(agencyIdentity);
    await expect(
      gateway.findByReference({
        source: 'platform_admin',
        identityId: 'identity',
      }),
    ).resolves.toBe(platformIdentity);
  });

  it('returns both sources for the same email so callers deny ambiguity', async () => {
    const agency = {
      findCandidatesByEmail: jest.fn().mockResolvedValue([agencyIdentity]),
    };
    const platform = {
      findCandidatesByEmail: jest.fn().mockResolvedValue([platformIdentity]),
    };
    const gateway = new CompositeAdminIdentityGateway(
      agency as unknown as AgencyAdminIdentityAdapter,
      platform as unknown as PlatformAdminIdentityAdapter,
    );

    await expect(
      gateway.findCandidatesByEmail('same@example.com'),
    ).resolves.toEqual([agencyIdentity, platformIdentity]);
  });
});
