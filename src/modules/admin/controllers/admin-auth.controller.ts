import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { extractLoginContext } from '../../auth/utils/login-context.util';
import { RequireAdminPermissions } from '../decorators/require-admin-permissions.decorator';
import {
  AdminEmptyBodyDto,
  AdminLoginDto,
  AdminTwoFactorEmailSendDto,
  AdminTwoFactorSetupConfirmDto,
  AdminTwoFactorSetupDto,
  AdminTwoFactorVerifyDto,
} from '../dto/admin-auth.dto';
import { AdminAccessGuard } from '../guards/admin-access.guard';
import type { AdminAuthenticatedRequest } from '../guards/admin-access.guard';
import { AdminAuthenticationGuard } from '../guards/admin-authentication.guard';
import { AdminBrowserOriginGuard } from '../guards/admin-browser-origin.guard';
import {
  AdminAuthenticatedSessionResult,
  AdminAuthService,
} from '../services/admin-auth.service';
import { AdminAuthRateLimitService } from '../services/admin-auth-rate-limit.service';
import { AdminAuthTokenService } from '../services/admin-auth-token.service';

export const ADMIN_REFRESH_COOKIE = 'lyra_admin_refresh';
export const ADMIN_REFRESH_COOKIE_PATH = '/api/admin/auth';

@Controller('admin/auth')
@UseGuards(AdminBrowserOriginGuard)
export class AdminAuthController {
  constructor(
    private readonly authService: AdminAuthService,
    private readonly tokenService: AdminAuthTokenService,
    private readonly rateLimitService: AdminAuthRateLimitService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  async login(
    @Body() dto: AdminLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const client = extractLoginContext(request);
    this.rateLimitService.assertAllowed(
      'login',
      `${client.ipAddress}:${dto.email.trim().toLowerCase()}`,
    );
    const result = await this.authService.login(
      dto.email,
      dto.password,
      client,
    );
    return this.writeSessionIfPresent(response, result);
  }

  @Post('2fa/login')
  async loginWithTwoFactor(
    @Body() dto: AdminTwoFactorVerifyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const client = extractLoginContext(request);
    this.rateLimitService.assertAllowed(
      'two_factor_verify',
      `${client.ipAddress}:${client.deviceFingerprint}`,
    );
    const result = await this.authService.loginWithTwoFactor(
      dto.tempToken,
      dto.code,
      client,
    );
    return this.writeSession(response, result);
  }

  @Post('2fa/email/send')
  sendTwoFactorEmail(
    @Body() dto: AdminTwoFactorEmailSendDto,
    @Req() request: Request,
  ) {
    const client = extractLoginContext(request);
    this.rateLimitService.assertAllowed(
      'two_factor_email',
      `${client.ipAddress}:${client.deviceFingerprint}`,
    );
    return this.authService.sendLoginEmailCode(dto.tempToken);
  }

  @Post('2fa/setup')
  setupTwoFactor(@Body() dto: AdminTwoFactorSetupDto, @Req() request: Request) {
    const client = extractLoginContext(request);
    this.rateLimitService.assertAllowed(
      dto.method === 'email' ? 'two_factor_email' : 'two_factor_verify',
      `${client.ipAddress}:${client.deviceFingerprint}`,
    );
    return this.authService.beginTwoFactorSetup(dto.tempToken, dto.method);
  }

  @Post('2fa/setup/confirm')
  async confirmTwoFactorSetup(
    @Body() dto: AdminTwoFactorSetupConfirmDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const client = extractLoginContext(request);
    this.rateLimitService.assertAllowed(
      'two_factor_verify',
      `${client.ipAddress}:${client.deviceFingerprint}`,
    );
    const result = await this.authService.confirmTwoFactorSetup(
      dto.tempToken,
      dto.method,
      dto.code,
      client,
    );
    return this.writeSession(response, result);
  }

  @Post('refresh')
  async refresh(
    @Body() _body: AdminEmptyBodyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const client = extractLoginContext(request);
    this.rateLimitService.assertAllowed(
      'refresh',
      `${client.ipAddress}:${client.deviceFingerprint}`,
    );
    const refreshToken = readCookie(request, ADMIN_REFRESH_COOKIE);
    if (!refreshToken) {
      this.clearRefreshCookie(response);
      throw new UnauthorizedException('Invalid administrative session.');
    }

    try {
      const result = await this.authService.refresh(refreshToken, client);
      return this.writeSession(response, result);
    } catch (error) {
      this.clearRefreshCookie(response);
      throw error;
    }
  }

  @Post('logout')
  async logout(
    @Body() _body: AdminEmptyBodyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.logout(
      readCookie(request, ADMIN_REFRESH_COOKIE),
      extractLoginContext(request),
    );
    this.clearRefreshCookie(response);
    return result;
  }

  @Get('me')
  @UseGuards(AdminAuthenticationGuard, AdminAccessGuard)
  @RequireAdminPermissions('admin.access')
  me(@Req() request: AdminAuthenticatedRequest) {
    return this.authService.getMe(request.adminPrincipal!);
  }

  private writeSessionIfPresent<T>(
    response: Response,
    result: T | AdminAuthenticatedSessionResult,
  ): T | Omit<AdminAuthenticatedSessionResult, 'refreshToken'> {
    if (isAdminAuthenticatedSessionResult(result)) {
      return this.writeSession(response, result);
    }
    return result;
  }

  private writeSession(
    response: Response,
    result: AdminAuthenticatedSessionResult,
  ): Omit<AdminAuthenticatedSessionResult, 'refreshToken'> {
    response.cookie(ADMIN_REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: ADMIN_REFRESH_COOKIE_PATH,
      maxAge: this.tokenService.getRefreshTokenTtlMs(),
    });
    return { accessToken: result.accessToken, user: result.user };
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(ADMIN_REFRESH_COOKIE, {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: ADMIN_REFRESH_COOKIE_PATH,
    });
  }
}

function isAdminAuthenticatedSessionResult(
  value: unknown,
): value is AdminAuthenticatedSessionResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'accessToken' in value &&
    typeof value.accessToken === 'string' &&
    'refreshToken' in value &&
    typeof value.refreshToken === 'string' &&
    'user' in value
  );
}

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }
    const key = part.slice(0, separatorIndex).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(separatorIndex + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
