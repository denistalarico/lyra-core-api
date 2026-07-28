import type { ConfigService } from '@nestjs/config';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Request, Response } from 'express';
import {
  AdminAuthController,
  ADMIN_REFRESH_COOKIE,
  ADMIN_REFRESH_COOKIE_PATH,
} from './admin-auth.controller';
import type { AdminAuthService } from '../services/admin-auth.service';
import type { AdminAuthRateLimitService } from '../services/admin-auth-rate-limit.service';
import type { AdminAuthTokenService } from '../services/admin-auth-token.service';
import { AdminBrowserOriginGuard } from '../guards/admin-browser-origin.guard';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(),
  generateURI: jest.fn(),
  verify: jest.fn(),
}));

function createHarness() {
  const authService = {
    login: jest.fn().mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: { adminId: 'admin-id' },
    }),
    refresh: jest.fn().mockResolvedValue({
      accessToken: 'rotated-access-token',
      refreshToken: 'rotated-refresh-token',
      user: { adminId: 'admin-id' },
    }),
    logout: jest.fn().mockResolvedValue({ success: true }),
  };
  const tokenService = {
    getRefreshTokenTtlMs: jest.fn().mockReturnValue(604_800_000),
  };
  const rateLimitService = { assertAllowed: jest.fn() };
  const configService = {
    get: jest.fn().mockReturnValue('production'),
  };
  const controller = new AdminAuthController(
    authService as unknown as AdminAuthService,
    tokenService as unknown as AdminAuthTokenService,
    rateLimitService as unknown as AdminAuthRateLimitService,
    configService as unknown as ConfigService,
  );
  const request = {
    headers: {
      cookie: `${ADMIN_REFRESH_COOKIE}=refresh-token`,
      'user-agent': 'Test',
    },
    ip: '127.0.0.1',
    socket: {},
  } as unknown as Request;
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  const response = { cookie, clearCookie } as unknown as Response;
  return {
    controller,
    authService,
    request,
    response,
    cookie,
    clearCookie,
  };
}

describe('AdminAuthController cookies', () => {
  it('applies the Admin origin guard to refresh, logout, login, and 2FA', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminAuthController),
    ).toContain(AdminBrowserOriginGuard);
  });

  it('keeps the refresh token exclusively in the secure HttpOnly cookie', async () => {
    const harness = createHarness();

    const result = await harness.controller.login(
      { email: 'admin@example.com', password: 'password' },
      harness.request,
      harness.response,
    );

    expect(harness.cookie).toHaveBeenCalledWith(
      ADMIN_REFRESH_COOKIE,
      'refresh-token',
      {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: ADMIN_REFRESH_COOKIE_PATH,
        maxAge: 604_800_000,
      },
    );
    expect(result).toEqual({
      accessToken: 'access-token',
      user: { adminId: 'admin-id' },
    });
    expect(result).not.toHaveProperty('refreshToken');
  });

  it('reads refresh exclusively from the cookie and rotates it', async () => {
    const harness = createHarness();

    await harness.controller.refresh({}, harness.request, harness.response);

    expect(harness.authService.refresh).toHaveBeenCalledWith(
      'refresh-token',
      expect.objectContaining({ ipAddress: '127.0.0.1' }),
    );
    expect(harness.cookie).toHaveBeenCalledWith(
      ADMIN_REFRESH_COOKIE,
      'rotated-refresh-token',
      expect.any(Object),
    );
  });

  it('clears the cookie on logout', async () => {
    const harness = createHarness();

    await expect(
      harness.controller.logout({}, harness.request, harness.response),
    ).resolves.toEqual({ success: true });
    expect(harness.clearCookie).toHaveBeenCalledWith(
      ADMIN_REFRESH_COOKIE,
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: ADMIN_REFRESH_COOKIE_PATH,
      }),
    );
  });
});
