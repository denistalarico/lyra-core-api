import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AdminAuthTokenService } from './admin-auth-token.service';

function service(values: Record<string, string | undefined> = {}) {
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return {
    jwt: new JwtService(),
    config,
    create(jwt = new JwtService()) {
      return new AdminAuthTokenService(jwt, config);
    },
  };
}

describe('AdminAuthTokenService', () => {
  const secrets = {
    ADMIN_JWT_ACCESS_SECRET: 'admin-access-secret-for-tests',
    ADMIN_JWT_2FA_SECRET: 'admin-2fa-secret-for-tests',
  };

  it('signs and verifies only the dedicated Admin access contract', async () => {
    const harness = service(secrets);
    const tokenService = harness.create(harness.jwt);
    const token = await tokenService.signAccessToken({
      sub: 'user-id',
      adminId: 'admin-id',
      identityTenantId: 'identity-tenant-id',
      sessionId: 'session-id',
      email: 'admin@example.com',
      roleKey: 'super_admin',
      sessionContext: 'admin',
    });

    await expect(tokenService.verifyAccessToken(token)).resolves.toEqual(
      expect.objectContaining({
        sessionContext: 'admin',
        adminId: 'admin-id',
      }),
    );
    const decoded = harness.jwt.decode<Record<string, unknown>>(token);
    expect(decoded).not.toHaveProperty('workspaceId');
    expect(decoded).not.toHaveProperty('tenantId');
    expect(decoded).not.toHaveProperty('allowedModules');
  });

  it('rejects a commercial JWT and a non-admin context', async () => {
    const harness = service(secrets);
    const tokenService = harness.create(harness.jwt);
    const commercialToken = await harness.jwt.signAsync(
      {
        sub: 'user-id',
        tenantId: 'commercial-tenant',
        workspaceId: 'workspace-id',
        role: 'owner',
        sessionId: 'session-id',
        email: 'user@example.com',
      },
      { secret: secrets.ADMIN_JWT_ACCESS_SECRET },
    );
    const wrongContextToken = await harness.jwt.signAsync(
      {
        sub: 'user-id',
        adminId: 'admin-id',
        identityTenantId: 'identity-tenant-id',
        sessionId: 'session-id',
        email: 'admin@example.com',
        roleKey: 'admin',
        sessionContext: 'agency',
      },
      { secret: secrets.ADMIN_JWT_ACCESS_SECRET },
    );

    await expect(
      tokenService.verifyAccessToken(commercialToken),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      tokenService.verifyAccessToken(wrongContextToken),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('does not accept an Agency 2FA token', async () => {
    const harness = service(secrets);
    const tokenService = harness.create(harness.jwt);
    const agencyToken = await harness.jwt.signAsync(
      {
        sub: 'user-id',
        tenantId: 'tenant-id',
        type: 'agency-2fa',
        method: 'authenticator',
      },
      { secret: secrets.ADMIN_JWT_2FA_SECRET },
    );

    await expect(
      tokenService.verifyTwoFactorToken(agencyToken),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('fails initialization in production when either Admin secret is absent', () => {
    const tokenService = service({ NODE_ENV: 'production' }).create();

    expect(() => tokenService.onModuleInit()).toThrow(
      'ADMIN_JWT_ACCESS_SECRET is required in production',
    );

    const missingTwoFactorSecret = service({
      NODE_ENV: 'production',
      ADMIN_JWT_ACCESS_SECRET: 'configured-access-secret',
    }).create();
    expect(() => missingTwoFactorSecret.onModuleInit()).toThrow(
      'ADMIN_JWT_2FA_SECRET is required in production',
    );
  });
});
