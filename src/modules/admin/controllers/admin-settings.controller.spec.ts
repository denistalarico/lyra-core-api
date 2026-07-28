import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ADMIN_PERMISSIONS_METADATA } from '../decorators/require-admin-permissions.decorator';
import type { AdminAuthenticatedRequest } from '../guards/admin-access.guard';
import { AdminAccessGuard } from '../guards/admin-access.guard';
import { AdminAuthenticationGuard } from '../guards/admin-authentication.guard';
import { AdminBrowserOriginGuard } from '../guards/admin-browser-origin.guard';
import type { AdminSettingsService } from '../services/admin-settings.service';
import type { AdminPrincipal } from '../types/admin-access.types';
import {
  ADMIN_REFRESH_COOKIE,
  ADMIN_REFRESH_COOKIE_PATH,
} from './admin-auth.controller';
import { AdminSettingsController } from './admin-settings.controller';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
  verify: jest.fn(),
}));
jest.mock('qrcode', () => ({
  __esModule: true,
  default: { toDataURL: jest.fn() },
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

describe('AdminSettingsController', () => {
  it('applies real Admin authentication, access, and browser-origin guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminSettingsController),
    ).toEqual([
      AdminBrowserOriginGuard,
      AdminAuthenticationGuard,
      AdminAccessGuard,
    ]);
  });

  it.each([
    ['overview', 'admin.settings.read'],
    ['updateProfile', 'admin.settings.update'],
    ['uploadProfileAvatar', 'admin.settings.update'],
    ['security', 'admin.security.read'],
    ['changePassword', 'admin.security.manage'],
    ['sessions', 'admin.sessions.read'],
    ['revokeSession', 'admin.sessions.revoke'],
  ] as const)('%s requires %s', (method, permission) => {
    expect(
      Reflect.getMetadata(
        ADMIN_PERMISSIONS_METADATA,
        AdminSettingsController.prototype[method],
      ),
    ).toContain(permission);
  });

  it('clears the HttpOnly refresh cookie when the current session is revoked', async () => {
    const settingsService = {
      revokeSession: jest.fn().mockResolvedValue({
        success: true,
        revokedCurrentSession: true,
      }),
    };
    const controller = new AdminSettingsController(
      settingsService as unknown as AdminSettingsService,
      {
        get: jest.fn().mockReturnValue('production'),
      } as unknown as ConfigService,
    );
    const request = {
      adminPrincipal: principal,
      headers: { 'user-agent': 'Test' },
      ip: '127.0.0.1',
      socket: {},
    } as unknown as AdminAuthenticatedRequest;
    const clearCookie = jest.fn();

    await controller.revokeSession(principal.sessionId, request, {
      clearCookie,
    } as unknown as Response);

    expect(settingsService.revokeSession).toHaveBeenCalledWith(
      principal,
      principal.sessionId,
      expect.objectContaining({ ipAddress: '127.0.0.1' }),
    );
    expect(clearCookie).toHaveBeenCalledWith(ADMIN_REFRESH_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: ADMIN_REFRESH_COOKIE_PATH,
    });
  });
});
