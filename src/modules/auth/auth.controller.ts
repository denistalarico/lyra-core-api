import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AcceptWorkspaceInvitationDto } from './dto/accept-workspace-invitation.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthTokenPayload } from './types/auth-token-payload.type';
import { AuthenticatedUser } from './decorators/authenticated-user.decorator';
import { AccessControlService } from '../../common/access-control/access-control.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly accessControlService: AccessControlService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@AuthenticatedUser() user: AuthTokenPayload) {
    if (!user.sub || !user.tenantId || !user.workspaceId) {
      throw new BadRequestException('Missing authenticated workspace context.');
    }

    const access = await this.accessControlService.getAccessContext(
      user.sub,
      user.tenantId,
      user.workspaceId,
    );

    return {
      user: {
        ...user,
        role: access.role,
        allowedModules: access.allowedModules,
        allowedSettingsSections: access.allowedSettingsSections,
      },
    };
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body.email);
  }

  @Get('invitations/:token')
  getInvitationByToken(@Param('token') token: string) {
    return this.authService.getInvitationByToken(token);
  }

  @Post('invitations/:token/accept')
  acceptInvitation(
    @Param('token') token: string,
    @Body() dto: AcceptWorkspaceInvitationDto,
  ) {
    return this.authService.acceptInvitation(token, dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @Post('2fa/login')
  loginWith2FA(
    @Body() body: { token: string; code: string },
    @Req() req: Request,
  ) {
    return this.authService.loginWith2FA(body.token, body.code, req);
  }

  @Post('2fa/email/send')
  send2FAEmail(@Body() body: { token: string }) {
    return this.authService.sendTwoFactorEmail(body.token);
  }
  @Post('2fa/email/verify')
  verify2FAEmail(
    @Body() body: { token: string; code: string },
    @Req() req: Request,
  ) {
    return this.authService.verifyTwoFactorEmail(body.token, body.code, req);
  }
}
