import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Repository } from 'typeorm';
import type { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import type { AdminIdentityGateway } from '../contracts/admin-identity.gateway';
import {
  PlatformAdminSessionEntity,
  PlatformAdminTwoFactorCodeEntity,
  PlatformInternalAdminEntity,
} from '../entities';
import type {
  AdminPrincipal,
  AdminTwoFactorTokenPayload,
} from '../types/admin-access.types';
import type { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import type { EmailService } from '../../email/email.service';
import type { AdminAccessService } from './admin-access.service';
import type { AdminAuditService } from './admin-audit.service';
import { AdminAuthService } from './admin-auth.service';
import type { AdminAuthTokenService } from './admin-auth-token.service';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'),
  generateURI: jest.fn(
    () =>
      'otpauth://totp/Lyra%20Admin:admin%40example.com?secret=JBSWY3DPEHPK3PXP',
  ),
  verify: jest.fn(({ token }: { token: string }) =>
    Promise.resolve({ valid: token === '123456' }),
  ),
}));

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-07-28T12:00:00.000Z');

const client = {
  ipAddress: '127.0.0.1',
  userAgent: 'Test Browser',
  acceptLanguage: 'pt-BR',
  deviceFingerprint: 'fingerprint',
  deviceName: 'Browser · Test',
  location: 'Local',
};

function admin(
  overrides: Partial<PlatformInternalAdminEntity> = {},
): PlatformInternalAdminEntity {
  return {
    id: ADMIN_ID,
    identityTenantId: TENANT_ID,
    userId: USER_ID,
    status: 'active',
    roleKey: 'super_admin',
    twoFactorRequired: true,
    locale: 'pt-BR',
    theme: 'system',
    timezone: 'America/Sao_Paulo',
    dateFormat: 'dd/MM/yyyy',
    timeFormat: '24h',
    lastAdminLoginAt: null,
    createdBy: null,
    updatedBy: null,
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function identity(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_ID,
    userId: USER_ID,
    email: 'admin@example.com',
    displayName: 'Platform Admin',
    status: 'active' as const,
    passwordConfigured: true,
    twoFactorEnabled: false,
    twoFactorMethod: 'authenticator' as const,
    ...overrides,
  };
}

function security(
  overrides: Partial<AgencyUserSecuritySettingsEntity> = {},
): AgencyUserSecuritySettingsEntity {
  return {
    id: 'security-id',
    tenantId: TENANT_ID,
    userId: USER_ID,
    currentEmail: 'admin@example.com',
    passwordHash: 'configured',
    passwordUpdatedAt: NOW,
    twoFactorEnabled: false,
    twoFactorMethod: 'authenticator',
    twoFactorSecretEncrypted: null,
    twoFactorPendingSecretEncrypted: null,
    loginAlertsEnabled: true,
    trustedDevicesEnabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function principal(): AdminPrincipal {
  return {
    adminId: ADMIN_ID,
    userId: USER_ID,
    identityTenantId: TENANT_ID,
    email: 'admin@example.com',
    displayName: 'Platform Admin',
    roleKey: 'super_admin',
    permissions: ['admin.access', 'admin.security.read'],
    sessionId: SESSION_ID,
    sessionContext: 'admin',
  };
}

function session(
  refreshToken = 'refresh-token',
  overrides: Partial<PlatformAdminSessionEntity> = {},
): PlatformAdminSessionEntity {
  return {
    id: SESSION_ID,
    adminId: ADMIN_ID,
    userId: USER_ID,
    identityTenantId: TENANT_ID,
    refreshTokenHash: hash(refreshToken),
    previousRefreshTokenHash: null,
    status: 'active',
    title: 'Sessão administrativa',
    browser: 'Test',
    userAgent: 'Test',
    acceptLanguage: 'pt-BR',
    ipAddress: '127.0.0.1',
    deviceFingerprint: 'fingerprint',
    deviceName: 'Test',
    location: 'Local',
    lastSeenAt: NOW,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function twoFactorPayload(
  overrides: Partial<AdminTwoFactorTokenPayload> = {},
): AdminTwoFactorTokenPayload {
  return {
    sub: USER_ID,
    adminId: ADMIN_ID,
    identityTenantId: TENANT_ID,
    email: 'admin@example.com',
    roleKey: 'super_admin',
    flow: 'login',
    method: 'authenticator',
    sessionContext: 'admin-2fa',
    ...overrides,
  };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function createHarness() {
  const adminRecord = admin();
  const securityRecord = security();
  const adminRepository = {
    findOne: jest.fn().mockResolvedValue(adminRecord),
    save: jest.fn((value: PlatformInternalAdminEntity) =>
      Promise.resolve(value),
    ),
  };
  const sessionRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn(
      (value: Partial<PlatformAdminSessionEntity>) =>
        value as PlatformAdminSessionEntity,
    ),
    save: jest.fn((value: PlatformAdminSessionEntity) =>
      Promise.resolve({
        ...value,
        id: value.id ?? SESSION_ID,
        createdAt: value.createdAt ?? NOW,
        updatedAt: value.updatedAt ?? NOW,
      }),
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const securityRepository = {
    findOne: jest.fn().mockResolvedValue(securityRecord),
    save: jest.fn((value: AgencyUserSecuritySettingsEntity) =>
      Promise.resolve(value),
    ),
  };
  const emailCodeRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn(
      (value: Partial<PlatformAdminTwoFactorCodeEntity>) =>
        value as PlatformAdminTwoFactorCodeEntity,
    ),
    save: jest.fn((value: PlatformAdminTwoFactorCodeEntity) =>
      Promise.resolve(value),
    ),
  };
  const gateway = {
    findCandidatesByEmail: jest.fn().mockResolvedValue([identity()]),
    verifyPassword: jest.fn().mockResolvedValue(true),
    findByIdentity: jest.fn().mockResolvedValue(identity()),
  };
  const accessService = {
    resolvePrincipal: jest.fn().mockResolvedValue(principal()),
  };
  const auditService = {
    record: jest.fn().mockResolvedValue({}),
  };
  const tokenService = {
    signTwoFactorToken: jest.fn().mockResolvedValue('admin-temp-token'),
    verifyTwoFactorToken: jest.fn().mockResolvedValue(twoFactorPayload()),
    signAccessToken: jest.fn().mockResolvedValue('admin-access-token'),
    getRefreshTokenTtlMs: jest.fn().mockReturnValue(7 * 24 * 60 * 60 * 1000),
  };
  const cryptoService = {
    encrypt: jest.fn((value: string) => `encrypted:${value}`),
    decrypt: jest.fn((value: string | null) =>
      value?.startsWith('encrypted:') ? value.slice(10) : null,
    ),
  };
  const emailService = {
    sendEmail: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AdminAuthService(
    adminRepository as unknown as Repository<PlatformInternalAdminEntity>,
    sessionRepository as unknown as Repository<PlatformAdminSessionEntity>,
    securityRepository as unknown as Repository<AgencyUserSecuritySettingsEntity>,
    emailCodeRepository as unknown as Repository<PlatformAdminTwoFactorCodeEntity>,
    gateway as unknown as AdminIdentityGateway,
    accessService as unknown as AdminAccessService,
    auditService as unknown as AdminAuditService,
    tokenService as unknown as AdminAuthTokenService,
    cryptoService as unknown as SettingsCryptoService,
    emailService as unknown as EmailService,
  );

  return {
    service,
    adminRecord,
    securityRecord,
    adminRepository,
    sessionRepository,
    securityRepository,
    emailCodeRepository,
    gateway,
    accessService,
    auditService,
    tokenService,
    cryptoService,
    emailService,
  };
}

describe('AdminAuthService login and 2FA', () => {
  it('returns the same generic error for an invalid credential', async () => {
    const harness = createHarness();
    harness.gateway.verifyPassword.mockResolvedValue(false);

    await expect(
      harness.service.login('admin@example.com', 'wrong', client),
    ).rejects.toThrow('Invalid administrative credentials.');
    expect(harness.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.auth.login_failed' }),
    );
  });

  it('denies an ambiguous identity without disclosing ambiguity publicly', async () => {
    const harness = createHarness();
    harness.gateway.findCandidatesByEmail.mockResolvedValue([
      identity(),
      identity({ userId: 'another-user' }),
    ]);

    await expect(
      harness.service.login('admin@example.com', 'password', client),
    ).rejects.toThrow('Invalid administrative credentials.');
  });

  it.each([
    ['missing binding', null],
    ['inactive binding', admin({ status: 'suspended' })],
    [
      'unknown role',
      {
        ...admin(),
        roleKey: 'unknown_role',
      } as unknown as PlatformInternalAdminEntity,
    ],
  ])('denies %s', async (_label, adminValue) => {
    const harness = createHarness();
    harness.adminRepository.findOne.mockResolvedValue(adminValue);

    await expect(
      harness.service.login('admin@example.com', 'password', client),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('requires 2FA setup without creating a session', async () => {
    const harness = createHarness();

    await expect(
      harness.service.login('admin@example.com', 'password', client),
    ).resolves.toEqual({
      requiresTwoFactorSetup: true,
      availableMethods: ['authenticator', 'email'],
      tempToken: 'admin-temp-token',
    });
    expect(harness.sessionRepository.save).not.toHaveBeenCalled();
  });

  it('challenges an identity with active 2FA without creating a session', async () => {
    const harness = createHarness();
    harness.gateway.findCandidatesByEmail.mockResolvedValue([
      identity({ twoFactorEnabled: true }),
    ]);

    await expect(
      harness.service.login('admin@example.com', 'password', client),
    ).resolves.toMatchObject({
      requiresTwoFactor: true,
      method: 'authenticator',
    });
    expect(harness.sessionRepository.save).not.toHaveBeenCalled();
  });

  it('creates an isolated Admin session when 2FA is not required', async () => {
    const harness = createHarness();
    harness.adminRecord.twoFactorRequired = false;

    const result = await harness.service.login(
      'admin@example.com',
      'password',
      client,
    );

    expect(result).toMatchObject({
      accessToken: 'admin-access-token',
      user: { adminId: ADMIN_ID, sessionId: SESSION_ID },
    });
    expect(harness.sessionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: ADMIN_ID,
        identityTenantId: TENANT_ID,
        status: 'active',
      }),
    );
    expect(result).not.toHaveProperty('workspaceId');
  });

  it('rejects invalid and Agency temporary tokens', async () => {
    const harness = createHarness();
    harness.tokenService.verifyTwoFactorToken.mockRejectedValue(
      new UnauthorizedException('Invalid administrative verification context.'),
    );

    await expect(
      harness.service.loginWithTwoFactor('agency-token', '123456', client),
    ).rejects.toThrow(UnauthorizedException);
    expect(harness.sessionRepository.save).not.toHaveBeenCalled();
  });

  it('rejects an invalid authenticator code', async () => {
    const harness = createHarness();
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    harness.gateway.findByIdentity.mockResolvedValue(
      identity({ twoFactorEnabled: true }),
    );
    harness.securityRecord.twoFactorSecretEncrypted = `encrypted:${secret}`;

    await expect(
      harness.service.loginWithTwoFactor('admin-temp-token', '000000', client),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('creates a session after a correct authenticator code', async () => {
    const harness = createHarness();
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    harness.gateway.findByIdentity.mockResolvedValue(
      identity({ twoFactorEnabled: true }),
    );
    harness.securityRecord.twoFactorSecretEncrypted = `encrypted:${secret}`;

    await expect(
      harness.service.loginWithTwoFactor('admin-temp-token', '123456', client),
    ).resolves.toMatchObject({ accessToken: 'admin-access-token' });
    expect(harness.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.auth.two_factor_succeeded' }),
    );
  });

  it('creates only an encrypted pending authenticator secret', async () => {
    const harness = createHarness();
    harness.tokenService.verifyTwoFactorToken.mockResolvedValue(
      twoFactorPayload({ flow: 'setup', method: undefined }),
    );

    const result = await harness.service.beginTwoFactorSetup(
      'admin-temp-token',
      'authenticator',
    );

    expect(result.method).toBe('authenticator');
    expect('otpauthUrl' in result && result.otpauthUrl).toContain(
      'otpauth://totp/',
    );
    expect('qrCodeDataUrl' in result && result.qrCodeDataUrl).toContain(
      'data:image/png;base64,',
    );
    expect(harness.securityRecord.twoFactorPendingSecretEncrypted).toMatch(
      /^encrypted:/,
    );
    expect(JSON.stringify(result)).not.toContain('encrypted:');
  });

  it('confirms authenticator setup, activates it and never returns the secret', async () => {
    const harness = createHarness();
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    harness.tokenService.verifyTwoFactorToken.mockResolvedValue(
      twoFactorPayload({ flow: 'setup', method: undefined }),
    );
    harness.securityRecord.twoFactorPendingSecretEncrypted = `encrypted:${secret}`;

    const result = await harness.service.confirmTwoFactorSetup(
      'admin-temp-token',
      'authenticator',
      '123456',
      client,
    );

    expect(harness.securityRecord).toMatchObject({
      twoFactorEnabled: true,
      twoFactorMethod: 'authenticator',
      twoFactorPendingSecretEncrypted: null,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('sends and confirms an Admin-scoped email setup code', async () => {
    const harness = createHarness();
    harness.tokenService.verifyTwoFactorToken.mockResolvedValue(
      twoFactorPayload({ flow: 'setup', method: undefined }),
    );

    await expect(
      harness.service.beginTwoFactorSetup('admin-temp-token', 'email'),
    ).resolves.toEqual({ method: 'email', emailSent: true });
    expect(harness.emailCodeRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'admin_setup' }),
    );

    harness.emailCodeRepository.findOne.mockResolvedValue({
      codeHash: hash('123456'),
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      attempts: 0,
    });
    await expect(
      harness.service.confirmTwoFactorSetup(
        'admin-temp-token',
        'email',
        '123456',
        client,
      ),
    ).resolves.toMatchObject({ accessToken: 'admin-access-token' });
    expect(harness.securityRecord.twoFactorMethod).toBe('email');
  });
});

describe('AdminAuthService session lifecycle', () => {
  it('rotates a valid refresh token and rejects immediate reuse', async () => {
    const harness = createHarness();
    harness.adminRecord.twoFactorRequired = false;
    const current = session();
    harness.sessionRepository.findOne.mockResolvedValueOnce(current);

    await expect(
      harness.service.refresh('refresh-token', client),
    ).resolves.toMatchObject({ accessToken: 'admin-access-token' });
    const [criteria, update] = harness.sessionRepository.update.mock
      .calls[0] as [
      Partial<PlatformAdminSessionEntity>,
      Partial<PlatformAdminSessionEntity>,
    ];
    expect(criteria).toMatchObject({
      id: SESSION_ID,
      refreshTokenHash: hash('refresh-token'),
    });
    expect(update.previousRefreshTokenHash).toBe(hash('refresh-token'));
    expect(update.refreshTokenHash).not.toBe(hash('refresh-token'));

    harness.sessionRepository.findOne.mockResolvedValueOnce(
      session('new-token', {
        previousRefreshTokenHash: hash('refresh-token'),
      }),
    );
    await expect(
      harness.service.refresh('refresh-token', client),
    ).rejects.toThrow(UnauthorizedException);
    expect(harness.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.auth.session_revoked' }),
    );
  });

  it('denies an expired session', async () => {
    const harness = createHarness();
    harness.sessionRepository.findOne.mockResolvedValue(
      session('refresh-token', { expiresAt: new Date(0) }),
    );

    await expect(
      harness.service.refresh('refresh-token', client),
    ).rejects.toThrow(UnauthorizedException);
    expect(harness.sessionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'expired' }),
    );
  });

  it('denies refresh after the administrator is suspended', async () => {
    const harness = createHarness();
    harness.sessionRepository.findOne.mockResolvedValue(session());
    harness.adminRepository.findOne.mockResolvedValue(
      admin({ status: 'suspended' }),
    );

    await expect(
      harness.service.refresh('refresh-token', client),
    ).rejects.toThrow(UnauthorizedException);
    expect(harness.sessionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'revoked' }),
    );
  });

  it('rejects a revoked session while authenticating an access token', async () => {
    const harness = createHarness();
    harness.sessionRepository.findOne.mockResolvedValue(
      session('refresh-token', {
        status: 'revoked',
        revokedAt: new Date(),
      }),
    );

    await expect(
      harness.service.authenticateAccessToken({
        sub: USER_ID,
        adminId: ADMIN_ID,
        identityTenantId: TENANT_ID,
        sessionId: SESSION_ID,
        email: 'admin@example.com',
        roleKey: 'super_admin',
        sessionContext: 'admin',
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(harness.accessService.resolvePrincipal).not.toHaveBeenCalled();
  });

  it('revokes on logout and remains idempotent for an absent cookie', async () => {
    const harness = createHarness();
    harness.sessionRepository.findOne.mockResolvedValue(session());

    await expect(
      harness.service.logout('refresh-token', client),
    ).resolves.toEqual({ success: true });
    expect(harness.sessionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'revoked' }),
    );

    harness.auditService.record.mockClear();
    await expect(harness.service.logout(null, client)).resolves.toEqual({
      success: true,
    });
    expect(harness.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.auth.logout',
        metadata: { result: 'session_not_found' },
      }),
    );
  });

  it('builds /me without Agency workspace fields', async () => {
    const harness = createHarness();

    const result = await harness.service.getMe(principal());

    expect(result).toEqual(
      expect.objectContaining({
        adminId: ADMIN_ID,
        userId: USER_ID,
        sessionId: SESSION_ID,
      }),
    );
    expect(result).not.toHaveProperty('workspaceId');
    expect(result).not.toHaveProperty('tenantId');
    expect(result).not.toHaveProperty('allowedModules');
  });

  it('does not pass passwords, codes or tokens into audit metadata', async () => {
    const harness = createHarness();
    harness.adminRecord.twoFactorRequired = false;

    await harness.service.login(
      'admin@example.com',
      'private-password',
      client,
    );

    const serialized = JSON.stringify(harness.auditService.record.mock.calls);
    expect(serialized).not.toContain('private-password');
    expect(serialized).not.toContain('admin-access-token');
    expect(serialized).not.toContain('refresh-token');
  });
});
