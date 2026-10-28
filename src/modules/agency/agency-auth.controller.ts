import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { RetryAfterInterceptor } from '../../common/security/retry-after.interceptor';
import { AuthenticatedUser } from '../auth/decorators/authenticated-user.decorator';
import { LoginDto } from '../auth/dto/login.dto';
import { RefreshTokenDto } from '../auth/dto/refresh-token.dto';
import { ResetPasswordDto } from '../auth/dto/reset-password.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthTokenPayload } from '../auth/types/auth-token-payload.type';
import { AgencyAuthService } from './agency-auth.service';

@Controller('agency/auth')
@UseInterceptors(RetryAfterInterceptor)
export class AgencyAuthController {
  constructor(private readonly agencyAuthService: AgencyAuthService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@AuthenticatedUser() user: AuthTokenPayload) {
    return this.agencyAuthService.getAuthenticatedUser(user);
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.agencyAuthService.login(dto, req);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.agencyAuthService.refresh(dto);
  }

  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) {
    return this.agencyAuthService.logout(dto.refreshToken);
  }

  @Post('forgot-password')
  forgotPassword(@Body() body: { email: string }, @Req() req: Request) {
    return this.agencyAuthService.forgotPassword(body.email, req);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.agencyAuthService.resetPassword(dto.token, dto.password, req);
  }

  @Post('2fa/login')
  loginWith2FA(
    @Body() body: { token: string; code: string },
    @Req() req: Request,
  ) {
    return this.agencyAuthService.loginWith2FA(body.token, body.code, req);
  }

  @Post('2fa/email/send')
  sendTwoFactorEmail(@Body() body: { token: string }, @Req() req: Request) {
    return this.agencyAuthService.sendTwoFactorEmail(body.token, req);
  }
}
