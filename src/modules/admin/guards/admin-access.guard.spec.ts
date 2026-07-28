import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ADMIN_PERMISSIONS_METADATA } from '../decorators/require-admin-permissions.decorator';
import { AdminAccessService } from '../services/admin-access.service';
import type { AdminPrincipal } from '../types/admin-access.types';
import { AdminAccessGuard } from './admin-access.guard';

function context(adminPrincipal?: AdminPrincipal): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ adminPrincipal }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as ExecutionContext;
}

function principal(
  permissions: AdminPrincipal['permissions'] = [
    'admin.access',
    'admin.settings.read',
  ],
): AdminPrincipal {
  return {
    adminId: 'admin-1',
    userId: 'user-1',
    identityTenantId: 'tenant-1',
    email: 'admin@example.com',
    displayName: 'Admin',
    roleKey: 'admin',
    permissions,
    sessionId: 'session-1',
    sessionContext: 'admin',
  };
}

function guard(required: readonly string[] = ['admin.settings.read']) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === ADMIN_PERMISSIONS_METADATA ? required : undefined,
    ),
  } as unknown as Reflector;
  const accessService = {
    hasAllPermissions: jest.fn(
      (permissions: readonly string[], expected: readonly string[]) =>
        permissions.includes('admin.access') &&
        expected.every((permission) => permissions.includes(permission)),
    ),
  } as unknown as AdminAccessService;

  return new AdminAccessGuard(reflector, accessService);
}

describe('AdminAccessGuard', () => {
  it('returns 401 without an administrative principal', () => {
    expect(() => guard().canActivate(context())).toThrow(UnauthorizedException);
  });

  it('denies a non-admin session context', () => {
    const invalid = {
      ...principal(),
      sessionContext: 'agency',
    } as unknown as AdminPrincipal;

    expect(() => guard().canActivate(context(invalid))).toThrow(
      ForbiddenException,
    );
  });

  it('returns 403 without admin.access or a required permission', () => {
    expect(() =>
      guard().canActivate(context(principal(['admin.settings.read']))),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard(['admin.settings.update']).canActivate(context(principal())),
    ).toThrow(ForbiddenException);
  });

  it('allows an admin-context principal with all required permissions', () => {
    expect(guard().canActivate(context(principal()))).toBe(true);
  });
});
