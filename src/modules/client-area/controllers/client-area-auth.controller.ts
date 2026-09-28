import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { LoginDto } from '../../auth/dto/login.dto';
import { RefreshTokenDto } from '../../auth/dto/refresh-token.dto';
import { normalizeClientAreaEmail } from '../client-area.types';
import {
  ClientAreaForgotPasswordDto,
  ClientAreaResetPasswordDto,
} from '../dto/client-area.dto';
import { ClientAreaEnabledGuard } from '../guards/client-area.guards';
import { ClientAreaAuthService } from '../services/client-area-auth.service';
import { ClientAreaPasswordResetService } from '../services/client-area-password-reset.service';
import {
  ClientAreaRateLimitService,
  clientAreaRateLimitIp,
} from '../services/client-area-rate-limit.service';

/**
 * Unauthenticated Client Area auth endpoints. Never mounted under
 * `/agency/*` or `/auth/*`; tokens issued here are useless there.
 * Every endpoint that accepts a secret or names an account is rate limited
 * (CA2); limits live in `CLIENT_AREA_RATE_LIMIT_RULES`.
 */
@Controller('client-area/auth')
@UseGuards(ClientAreaEnabledGuard)
export class ClientAreaAuthController {
  constructor(
    private readonly auth: ClientAreaAuthService,
    private readonly passwordReset: ClientAreaPasswordResetService,
    private readonly rateLimit: ClientAreaRateLimitService,
  ) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = clientAreaRateLimitIp(req);
    const email = normalizeClientAreaEmail(dto.email);
    this.rateLimit.consume({
      login_ip: ip,
      login_account: `${ip}:${email}`,
      login_email: email,
    });
    return this.auth.login(dto.email, dto.password, req);
  }

  @Post('2fa/login')
  @HttpCode(200)
  loginWithTwoFactor(
    @Body() body: { token: string; code: string },
    @Req() req: Request,
  ) {
    this.rateLimit.consume({ two_factor_ip: clientAreaRateLimitIp(req) });
    return this.auth.loginWithTwoFactor(body?.token, body?.code, req);
  }

  @Post('2fa/email/send')
  @HttpCode(200)
  sendTwoFactorEmail(@Body() body: { token: string }, @Req() req: Request) {
    this.rateLimit.consume({
      two_factor_email_ip: clientAreaRateLimitIp(req),
    });
    return this.auth.sendTwoFactorEmail(body?.token);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    this.rateLimit.consume({ refresh_ip: clientAreaRateLimitIp(req) });
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(
    @Body() dto: ClientAreaForgotPasswordDto,
    @Req() req: Request,
  ) {
    this.rateLimit.consume({
      password_forgot_ip: clientAreaRateLimitIp(req),
      password_forgot_email: normalizeClientAreaEmail(dto.email),
    });
    return this.passwordReset.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ClientAreaResetPasswordDto, @Req() req: Request) {
    this.rateLimit.consume({ password_reset_ip: clientAreaRateLimitIp(req) });
    return this.passwordReset.resetPassword(
      dto.token,
      dto.password,
      dto.passwordConfirmation,
    );
  }
}
