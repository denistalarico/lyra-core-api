import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import type { EmailService } from '../../email/email.service';
import type { AdminIdentityGateway } from '../contracts/admin-identity.gateway';
import {
  PlatformAdminIdentityEntity,
  PlatformAdminIdentityTokenEntity,
  PlatformAdminInvitationEntity,
} from '../entities';
import type { AdminAuditService } from './admin-audit.service';
import { AdminIdentityLifecycleService } from './admin-identity-lifecycle.service';

const client = {
  ipAddress: '127.0.0.1',
  userAgent: 'test',
  acceptLanguage: 'pt-BR',
  deviceFingerprint: 'device',
  deviceName: 'test',
  location: null,
};

function createHarness(candidates: unknown[] = []) {
  const identity = Object.assign(new PlatformAdminIdentityEntity(), {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'new@example.com',
    normalizedEmail: 'new@example.com',
    displayName: 'new',
    status: 'pending' as const,
    passwordHash: null,
    passwordConfiguredAt: null,
    twoFactorEnabled: false,
    twoFactorMethod: null,
    twoFactorSecretEncrypted: null,
    twoFactorPendingSecretEncrypted: null,
    emailVerifiedAt: null,
    lastPasswordChangeAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    metadata: {},
  });
  const savedTokens: Partial<PlatformAdminIdentityTokenEntity>[] = [];
  const identityRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockReturnValue(identity),
    save: jest.fn().mockResolvedValue(identity),
  };
  const manager = {
    update: jest.fn().mockResolvedValue({ affected: 0 }),
    create: jest.fn(
      (_entity: unknown, value: Partial<PlatformAdminIdentityTokenEntity>) =>
        value,
    ),
    save: jest.fn((value: Partial<PlatformAdminIdentityTokenEntity>) => {
      savedTokens.push(value);
      return Promise.resolve(value);
    }),
  };
  const dataSource = {
    transaction: jest.fn(
      (
        callback: (value: typeof manager) => Promise<unknown>,
      ): Promise<unknown> => callback(manager),
    ),
  };
  const gateway = {
    findCandidatesByEmail: jest.fn().mockResolvedValue(candidates),
  };
  const emailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const auditService = { record: jest.fn().mockResolvedValue({}) };
  const service = new AdminIdentityLifecycleService(
    identityRepository as unknown as Repository<PlatformAdminIdentityEntity>,
    {} as Repository<PlatformAdminIdentityTokenEntity>,
    dataSource as unknown as DataSource,
    gateway as unknown as AdminIdentityGateway,
    auditService as unknown as AdminAuditService,
    emailService as unknown as EmailService,
    {
      get: jest.fn((name: string) =>
        name === 'ADMIN_WEB_URL' ? 'http://admin.test' : undefined,
      ),
    } as unknown as ConfigService,
  );
  return { service, savedTokens, emailService };
}

describe('AdminIdentityLifecycleService', () => {
  it('provisions one pending identity and persists only an activation token hash', async () => {
    const { service, savedTokens, emailService } = createHarness();
    const invitation = Object.assign(new PlatformAdminInvitationEntity(), {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'new@example.com',
      normalizedEmail: 'new@example.com',
      roleKey: 'support_admin' as const,
      status: 'pending' as const,
    });

    await expect(
      service.provisionFromInvitation(invitation, client),
    ).resolves.toEqual({
      status: 'activation_required',
      emailMasked: 'n***@example.com',
      activationEmailSent: true,
    });
    expect(savedTokens).toHaveLength(1);
    expect(savedTokens[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(savedTokens[0]).not.toHaveProperty('token');
    expect(emailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'new@example.com' }),
    );
  });

  it('returns the same public response when password and 2FA identities do not exist', async () => {
    const { service, emailService } = createHarness([]);

    await expect(
      service.requestPasswordReset('missing@example.com', client),
    ).resolves.toEqual({
      message: 'Se existir uma conta válida, enviaremos as instruções.',
    });
    await expect(
      service.requestTwoFactorRecovery('missing@example.com', client),
    ).resolves.toEqual({
      message: 'Se existir uma conta válida, enviaremos as instruções.',
    });
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });
});
