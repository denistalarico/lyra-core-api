import * as argon2 from 'argon2';
import type { Repository } from 'typeorm';
import { PlatformAdminIdentityEntity } from '../entities';
import { PlatformAdminIdentityAdapter } from './platform-admin-identity.adapter';

const ID = '11111111-1111-4111-8111-111111111111';
const reference = { source: 'platform_admin' as const, identityId: ID };

function harness() {
  const identity: PlatformAdminIdentityEntity = Object.assign(
    new PlatformAdminIdentityEntity(),
    {
      id: ID,
      email: 'admin@example.com',
      normalizedEmail: 'admin@example.com',
      displayName: 'Admin',
      status: 'active' as const,
      passwordHash: null,
      passwordConfiguredAt: null,
      twoFactorEnabled: false,
      twoFactorMethod: null,
      twoFactorSecretEncrypted: null,
      twoFactorPendingSecretEncrypted: null,
      emailVerifiedAt: new Date(),
      lastPasswordChangeAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  );
  const repository = {
    findOne: jest
      .fn()
      .mockImplementation(({ where }: { where: { id?: string } }) =>
        Promise.resolve(where.id === ID ? identity : null),
      ),
    find: jest.fn().mockResolvedValue([identity]),
    save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
    createQueryBuilder: jest.fn(() => ({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(identity),
    })),
  };
  return {
    identity,
    adapter: new PlatformAdminIdentityAdapter(
      repository as unknown as Repository<PlatformAdminIdentityEntity>,
    ),
  };
}

describe('PlatformAdminIdentityAdapter', () => {
  it('hashes and verifies the password without exposing credential material', async () => {
    const { adapter, identity } = harness();

    await expect(
      adapter.setPassword(reference, 'a-secure-password-123'),
    ).resolves.toBe(true);

    expect(identity.passwordHash).not.toBe('a-secure-password-123');
    expect(
      await argon2.verify(identity.passwordHash!, 'a-secure-password-123'),
    ).toBe(true);
    await expect(
      adapter.verifyPassword(reference, 'a-secure-password-123'),
    ).resolves.toBe(true);
    await expect(
      adapter.findByReference(reference),
    ).resolves.not.toHaveProperty('passwordHash');
  });

  it('locks after the configured number of failures and clears lock on success', async () => {
    const { adapter, identity } = harness();

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await expect(
        adapter.registerFailedLogin(reference, 5, 60_000),
      ).resolves.toEqual({ locked: false });
    }
    await expect(
      adapter.registerFailedLogin(reference, 5, 60_000),
    ).resolves.toEqual({ locked: true });
    expect(identity.status).toBe('locked');
    expect(identity.lockedUntil).toBeInstanceOf(Date);

    await adapter.registerSuccessfulLogin(reference);
    expect(identity.status).toBe('active');
    expect(identity.failedLoginAttempts).toBe(0);
    expect(identity.lockedUntil).toBeNull();
  });

  it('clears active and pending 2FA secrets for controlled recovery', async () => {
    const { adapter, identity } = harness();
    identity.twoFactorEnabled = true;
    identity.twoFactorMethod = 'authenticator';
    identity.twoFactorSecretEncrypted = 'encrypted-active';
    identity.twoFactorPendingSecretEncrypted = 'encrypted-pending';

    await expect(adapter.clearTwoFactor(reference)).resolves.toBe(true);
    expect(identity).toMatchObject({
      twoFactorEnabled: false,
      twoFactorMethod: null,
      twoFactorSecretEncrypted: null,
      twoFactorPendingSecretEncrypted: null,
    });
  });
});
