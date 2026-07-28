import * as argon2 from 'argon2';
import type { Repository } from 'typeorm';
import { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceUserEntity,
} from '../../agency/entities/agency-settings.entities';
import { AgencyAdminIdentityAdapter } from './agency-admin-identity.adapter';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function security(
  overrides: Partial<AgencyUserSecuritySettingsEntity> = {},
): AgencyUserSecuritySettingsEntity {
  return {
    tenantId: TENANT_ID,
    userId: USER_ID,
    currentEmail: 'OWNER@Example.COM ',
    passwordHash: 'configured',
    twoFactorEnabled: true,
    twoFactorMethod: 'authenticator',
    ...overrides,
  } as AgencyUserSecuritySettingsEntity;
}

function membership(
  overrides: Partial<AgencyWorkspaceUserEntity> = {},
): AgencyWorkspaceUserEntity {
  return {
    tenantId: TENANT_ID,
    userId: USER_ID,
    name: 'Agency Owner',
    email: 'owner@example.com',
    status: 'active',
    updatedAt: new Date(),
    ...overrides,
  } as AgencyWorkspaceUserEntity;
}

function createAdapter(options?: {
  securityRecord?: AgencyUserSecuritySettingsEntity | null;
  membershipRecord?: AgencyWorkspaceUserEntity | null;
  profileRecord?: AgencyUserProfileEntity | null;
}) {
  const securityRepository = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        options?.securityRecord === undefined
          ? security()
          : options.securityRecord,
      ),
    find: jest.fn(),
  };
  const membershipRepository = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        options?.membershipRecord === undefined
          ? membership()
          : options.membershipRecord,
      ),
  };
  const profileRepository = {
    findOne: jest.fn().mockResolvedValue(
      options?.profileRecord === undefined
        ? ({
            tenantId: TENANT_ID,
            userId: USER_ID,
            displayName: 'Owner Profile',
            email: 'owner@example.com',
          } as AgencyUserProfileEntity)
        : options.profileRecord,
    ),
  };

  return {
    adapter: new AgencyAdminIdentityAdapter(
      securityRepository as unknown as Repository<AgencyUserSecuritySettingsEntity>,
      membershipRepository as unknown as Repository<AgencyWorkspaceUserEntity>,
      profileRepository as unknown as Repository<AgencyUserProfileEntity>,
    ),
    securityRepository,
    membershipRepository,
  };
}

describe('AgencyAdminIdentityAdapter', () => {
  it('resolves an active identity without exposing credential material', async () => {
    const { adapter } = createAdapter();

    const identity = await adapter.findByIdentity(TENANT_ID, USER_ID);

    expect(identity).toEqual({
      tenantId: TENANT_ID,
      userId: USER_ID,
      email: 'owner@example.com',
      displayName: 'Owner Profile',
      status: 'active',
      passwordConfigured: true,
      twoFactorEnabled: true,
      twoFactorMethod: 'authenticator',
    });
    expect(identity).not.toHaveProperty('passwordHash');
    expect(identity).not.toHaveProperty('twoFactorSecretEncrypted');
  });

  it('normalizes e-mail before returning and querying candidates', async () => {
    const { adapter, securityRepository } = createAdapter();
    securityRepository.find.mockResolvedValue([security()]);

    await expect(
      adapter.findCandidatesByEmail('  Owner@EXAMPLE.com '),
    ).resolves.toEqual([
      expect.objectContaining({ email: 'owner@example.com' }),
    ]);

    expect(securityRepository.find).toHaveBeenCalledTimes(1);
  });

  it('ignores identities without an active Agency membership', async () => {
    const { adapter } = createAdapter({ membershipRecord: null });

    await expect(
      adapter.findByIdentity(TENANT_ID, USER_ID),
    ).resolves.toBeNull();
  });

  it('validates a configured argon2 password and rejects an invalid password', async () => {
    const passwordHash = await argon2.hash('valid-password');
    const { adapter } = createAdapter({
      securityRecord: security({ passwordHash }),
    });

    await expect(
      adapter.verifyPassword(TENANT_ID, USER_ID, 'valid-password'),
    ).resolves.toBe(true);
    await expect(
      adapter.verifyPassword(TENANT_ID, USER_ID, 'invalid-password'),
    ).resolves.toBe(false);
  });

  it('returns false for an absent or malformed password hash', async () => {
    const withoutHash = createAdapter({
      securityRecord: security({ passwordHash: null }),
    }).adapter;
    const malformedHash = createAdapter({
      securityRecord: security({ passwordHash: 'not-an-argon2-hash' }),
    }).adapter;

    await expect(
      withoutHash.verifyPassword(TENANT_ID, USER_ID, 'password'),
    ).resolves.toBe(false);
    await expect(
      malformedHash.verifyPassword(TENANT_ID, USER_ID, 'password'),
    ).resolves.toBe(false);
  });
});
