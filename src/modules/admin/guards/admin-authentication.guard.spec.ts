import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AdminAuthService } from '../services/admin-auth.service';
import type { AdminAuthTokenService } from '../services/admin-auth-token.service';
import type {
  AdminAuthTokenPayload,
  AdminPrincipal,
} from '../types/admin-access.types';
import { AdminAuthenticationGuard } from './admin-authentication.guard';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
  verify: jest.fn(),
}));

const payload: AdminAuthTokenPayload = {
  sub: 'user-id',
  adminId: 'admin-id',
  identityTenantId: 'identity-tenant-id',
  sessionId: 'session-id',
  email: 'admin@example.com',
  roleKey: 'admin',
  sessionContext: 'admin',
};

const principal: AdminPrincipal = {
  adminId: 'admin-id',
  userId: 'user-id',
  identityTenantId: 'identity-tenant-id',
  email: 'admin@example.com',
  displayName: 'Admin',
  roleKey: 'admin',
  permissions: ['admin.access'],
  sessionId: 'session-id',
  sessionContext: 'admin',
};

function createHarness(authorization = 'Bearer admin-token') {
  const request: Record<string, unknown> = {
    headers: { authorization },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
  const tokenService = {
    verifyAccessToken: jest.fn().mockResolvedValue(payload),
  };
  const authService = {
    authenticateAccessToken: jest.fn().mockResolvedValue(principal),
  };
  const guard = new AdminAuthenticationGuard(
    tokenService as unknown as AdminAuthTokenService,
    authService as unknown as AdminAuthService,
  );
  return { guard, request, context, tokenService, authService };
}

describe('AdminAuthenticationGuard', () => {
  it('validates the Admin token and fills request.adminPrincipal', async () => {
    const harness = createHarness();

    await expect(harness.guard.canActivate(harness.context)).resolves.toBe(
      true,
    );
    expect(harness.request.adminPrincipal).toEqual(principal);
  });

  it('rejects malformed authorization without consulting a commercial user', async () => {
    const harness = createHarness('');
    harness.request.user = { workspaceId: 'commercial-workspace' };

    await expect(harness.guard.canActivate(harness.context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(harness.authService.authenticateAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a revoked session reported by the runtime service', async () => {
    const harness = createHarness();
    harness.authService.authenticateAccessToken.mockRejectedValue(
      new UnauthorizedException('Invalid administrative session.'),
    );

    await expect(harness.guard.canActivate(harness.context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(harness.request.adminPrincipal).toBeUndefined();
  });
});
