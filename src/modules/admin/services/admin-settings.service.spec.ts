import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import type { FilesService } from '../../../common/files/files.service';
import type { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import type { EmailService } from '../../email/email.service';
import type {
  AdminIdentityGateway,
  AdminIdentityRecord,
} from '../contracts/admin-identity.gateway';
import type {
  PlatformAdminSessionEntity,
  PlatformAdminTwoFactorCodeEntity,
  PlatformInternalAdminEntity,
} from '../entities';
import type { AdminPrincipal } from '../types/admin-access.types';
import type { AdminAuditService } from './admin-audit.service';
import {
  AdminSettingsService,
  isValidTimeZone,
} from './admin-settings.service';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'temporary-secret'),
  generateURI: jest.fn(() => 'otpauth://temporary'),
  verify: jest.fn(({ token }: { token: string }) =>
    Promise.resolve({ valid: token === '123456' }),
  ),
}));
jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn(() => 'data:image/png;base64,temporary') },
}));

const principal: AdminPrincipal = {
  adminId: 'admin-1',
  userId: 'user-1',
  identityTenantId: 'tenant-1',
  email: 'admin@example.com',
  displayName: 'Admin',
  roleKey: 'super_admin',
  permissions: ['admin.access'],
  sessionId: 'session-current',
  sessionContext: 'admin',
};
const client = {
  ipAddress: '127.0.0.1',
  userAgent: 'Test',
  acceptLanguage: 'pt-BR',
  deviceFingerprint: 'fingerprint',
  deviceName: 'Browser',
  location: null,
};

function createHarness() {
  const admin = {
    id: principal.adminId,
    userId: principal.userId,
    identityTenantId: principal.identityTenantId,
    status: 'active',
    roleKey: 'super_admin',
    twoFactorRequired: true,
    locale: 'pt-BR',
    theme: 'system',
    timezone: 'America/Sao_Paulo',
    dateFormat: 'dd/MM/yyyy',
    timeFormat: '24h',
  } as PlatformInternalAdminEntity;
  const identity: AdminIdentityRecord = {
    tenantId: principal.identityTenantId,
    userId: principal.userId,
    email: principal.email,
    displayName: 'Admin',
    status: 'active',
    passwordConfigured: true,
    twoFactorEnabled: true,
    twoFactorMethod: 'authenticator',
    phone: null,
    jobTitle: null,
    avatarUrl: null,
  };
  const security = {
    tenantId: principal.identityTenantId,
    userId: principal.userId,
    passwordHash: 'private',
    twoFactorEnabled: true,
    twoFactorMethod: 'authenticator',
    twoFactorSecretEncrypted: 'encrypted:configured',
    twoFactorPendingSecretEncrypted: 'encrypted:temporary-secret',
  } as AgencyUserSecuritySettingsEntity;
  const sessions = [
    {
      id: 'session-current',
      adminId: principal.adminId,
      userId: principal.userId,
      identityTenantId: principal.identityTenantId,
      status: 'active',
      title: 'Current',
      browser: 'Chrome',
      deviceName: 'Chrome · Linux',
      ipAddress: '127.0.0.1',
      location: null,
      lastSeenAt: new Date(),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      refreshTokenHash: 'private-current',
      previousRefreshTokenHash: null,
      userAgent: 'private-agent',
    },
    {
      id: 'session-other',
      adminId: principal.adminId,
      userId: principal.userId,
      identityTenantId: principal.identityTenantId,
      status: 'active',
      title: 'Other',
      browser: 'Safari',
      deviceName: 'Safari · macOS',
      ipAddress: '10.0.0.1',
      location: 'Lisbon',
      lastSeenAt: new Date(),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      refreshTokenHash: 'private-other',
      previousRefreshTokenHash: null,
      userAgent: 'private-agent',
    },
  ] as PlatformAdminSessionEntity[];
  const audits: Record<string, unknown>[] = [];
  const adminRepository = {
    findOne: jest
      .fn()
      .mockImplementation(({ where }) =>
        Promise.resolve(
          where.id === principal.adminId &&
            where.userId === principal.userId &&
            where.identityTenantId === principal.identityTenantId
            ? admin
            : null,
        ),
      ),
    save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
  };
  const sessionRepository = {
    count: jest.fn().mockResolvedValue(2),
    find: jest
      .fn()
      .mockImplementation(({ where }) =>
        Promise.resolve(
          sessions.filter(
            (session) =>
              session.adminId === where.adminId &&
              session.userId === where.userId &&
              session.identityTenantId === where.identityTenantId &&
              (where.status === undefined || session.status === where.status) &&
              (typeof where.id !== 'object' ||
                session.id !== principal.sessionId),
          ),
        ),
      ),
    findOne: jest
      .fn()
      .mockImplementation(({ where }) =>
        Promise.resolve(
          sessions.find(
            (session) =>
              session.id === where.id &&
              session.adminId === where.adminId &&
              session.userId === where.userId,
          ) ?? null,
        ),
      ),
    save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
  };
  const securityRepository = {
    findOne: jest.fn().mockResolvedValue(security),
    save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
  };
  const emailCodeRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((value) => value),
    save: jest.fn().mockImplementation((value) => Promise.resolve(value)),
  };
  const gateway = {
    findByIdentity: jest.fn().mockResolvedValue(identity),
    verifyPassword: jest.fn().mockResolvedValue(true),
    updateProfile: jest
      .fn()
      .mockImplementation((_tenant, _user, update) =>
        Promise.resolve(Object.assign(identity, update)),
      ),
    updatePassword: jest.fn().mockResolvedValue(true),
  };
  const auditService = {
    record: jest.fn().mockImplementation((event) => {
      audits.push(event);
      return Promise.resolve(event);
    }),
  };
  const filesService = {
    uploadImageAsset: jest.fn().mockResolvedValue({
      url: '/assets/admin/avatar.webp',
      path: 'admin/avatar.webp',
    }),
  };
  const service = new AdminSettingsService(
    adminRepository as unknown as Repository<PlatformInternalAdminEntity>,
    sessionRepository as unknown as Repository<PlatformAdminSessionEntity>,
    securityRepository as unknown as Repository<AgencyUserSecuritySettingsEntity>,
    emailCodeRepository as unknown as Repository<PlatformAdminTwoFactorCodeEntity>,
    gateway as unknown as AdminIdentityGateway,
    auditService as unknown as AdminAuditService,
    {
      encrypt: jest.fn((value) => `encrypted:${value}`),
      decrypt: jest.fn((value: string) => value.replace('encrypted:', '')),
    } as unknown as SettingsCryptoService,
    { sendEmail: jest.fn() } as unknown as EmailService,
    filesService as unknown as FilesService,
  );
  return {
    service,
    admin,
    identity,
    security,
    sessions,
    gateway,
    auditService,
    filesService,
  };
}

describe('AdminSettingsService', () => {
  it('reads and updates only the principal profile', async () => {
    const harness = createHarness();
    await expect(harness.service.getProfile(principal)).resolves.toEqual(
      expect.objectContaining({
        displayName: 'Admin',
        email: principal.email,
      }),
    );
    await harness.service.updateProfile(
      principal,
      { displayName: 'Dana', phone: null, jobTitle: null },
      client,
    );
    expect(harness.gateway.updateProfile).toHaveBeenCalledWith(
      principal.identityTenantId,
      principal.userId,
      expect.objectContaining({ displayName: 'Dana' }),
    );
  });

  it('uploads and persists a cropped profile avatar', async () => {
    const harness = createHarness();
    const gateway = harness.gateway as typeof harness.gateway & {
      findByReference: jest.Mock;
    };
    gateway.findByReference = jest.fn().mockResolvedValue(harness.identity);
    gateway.updateProfile.mockImplementation((_reference, update) =>
      Promise.resolve(Object.assign(harness.identity, update)),
    );

    await expect(
      harness.service.uploadProfileAvatar(
        principal,
        {
          buffer: Buffer.from('avatar'),
          mimetype: 'image/webp',
          size: 6,
          originalname: 'avatar.webp',
        } as Express.Multer.File,
        client,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ avatarUrl: '/assets/admin/avatar.webp' }),
    );
    expect(harness.filesService.uploadImageAsset).toHaveBeenCalledWith(
      expect.objectContaining({ maxDimension: 512 }),
    );
    expect(gateway.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'agency' }),
      expect.objectContaining({ avatarUrl: '/assets/admin/avatar.webp' }),
    );
  });

  it('persists valid preferences and rejects an invalid timezone', async () => {
    const harness = createHarness();
    await harness.service.updatePreferences(
      principal,
      {
        locale: 'en-US',
        theme: 'dark',
        timezone: 'Europe/Lisbon',
        dateFormat: 'yyyy-MM-dd',
        timeFormat: '12h',
      },
      client,
    );
    expect(harness.admin).toEqual(
      expect.objectContaining({
        locale: 'en-US',
        theme: 'dark',
        timezone: 'Europe/Lisbon',
        dateFormat: 'yyyy-MM-dd',
        timeFormat: '12h',
      }),
    );
    await expect(
      harness.service.updatePreferences(
        principal,
        {
          locale: 'pt-BR',
          theme: 'system',
          timezone: 'Mars/Olympus',
          dateFormat: 'dd/MM/yyyy',
          timeFormat: '24h',
        },
        client,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
  });

  it('rejects an invalid current password and revokes other sessions after change', async () => {
    const harness = createHarness();
    harness.gateway.updatePassword.mockResolvedValueOnce(false);
    await expect(
      harness.service.changePassword(
        principal,
        { currentPassword: 'wrong', newPassword: 'new-password' },
        client,
      ),
    ).rejects.toThrow(UnauthorizedException);
    await harness.service.changePassword(
      principal,
      { currentPassword: 'current', newPassword: 'new-password' },
      client,
    );
    expect(harness.sessions[0].status).toBe('active');
    expect(harness.sessions[1].status).toBe('revoked');
    expect(harness.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.settings.password_changed',
        metadata: { otherSessionsRevoked: 1 },
      }),
    );
    expect(
      JSON.stringify(harness.auditService.record.mock.calls),
    ).not.toContain('new-password');
    expect(
      JSON.stringify(harness.auditService.record.mock.calls),
    ).not.toContain('current');
  });

  it('never allows required 2FA to be disabled', async () => {
    const harness = createHarness();
    await expect(
      harness.service.disableTwoFactor(principal, 'current', client),
    ).rejects.toThrow(ForbiddenException);
    expect(harness.security.twoFactorEnabled).toBe(true);
    expect(harness.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.settings.two_factor_disable_denied',
        outcome: 'denied',
      }),
    );
  });

  it('keeps the configured method until the new method is confirmed', async () => {
    const harness = createHarness();
    harness.identity.twoFactorMethod = 'email';
    harness.security.twoFactorMethod = 'email';
    await harness.service.beginTwoFactorSetup(principal, {
      method: 'authenticator',
      currentPassword: 'current',
    });
    expect(harness.gateway.verifyPassword).toHaveBeenCalledWith(
      principal.identityTenantId,
      principal.userId,
      'current',
    );
    expect(harness.security.twoFactorMethod).toBe('email');
    await harness.service.confirmTwoFactorSetup(
      principal,
      { method: 'authenticator', code: '123456' },
      client,
    );
    expect(harness.security.twoFactorMethod).toBe('authenticator');
    expect(harness.security.twoFactorPendingSecretEncrypted).toBeNull();
    expect(harness.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.settings.two_factor_method_changed',
      }),
    );
  });

  it('lists no private session data and cannot revoke another admin session', async () => {
    const harness = createHarness();
    const result = await harness.service.getSessions(principal);
    expect(result).toHaveLength(2);
    expect(result[0]).not.toHaveProperty('refreshTokenHash');
    expect(result[0]).not.toHaveProperty('previousRefreshTokenHash');
    expect(result[0]).not.toHaveProperty('userAgent');
    await expect(
      harness.service.revokeSession(principal, 'another-admin-session', client),
    ).rejects.toThrow(NotFoundException);
  });

  it('revokes others while preserving the current session', async () => {
    const harness = createHarness();
    await expect(
      harness.service.revokeOtherSessionsWithAudit(principal, client),
    ).resolves.toEqual({ success: true, revokedCount: 1 });
    expect(harness.sessions[0].status).toBe('active');
    expect(harness.sessions[1].status).toBe('revoked');
  });
});
