import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { MAX_IMAGE_UPLOAD_BYTES } from '../../../common/files/files.service';
import { extractLoginContext } from '../../auth/utils/login-context.util';
import { RequireAdminPermissions } from '../decorators/require-admin-permissions.decorator';
import {
  BeginAdminTwoFactorSetupDto,
  ChangeAdminPasswordDto,
  ConfirmAdminTwoFactorSetupDto,
  DisableAdminTwoFactorDto,
  UpdateAdminPreferencesDto,
  UpdateAdminProfileDto,
} from '../dto/admin-settings.dto';
import {
  AdminAccessGuard,
  type AdminAuthenticatedRequest,
} from '../guards/admin-access.guard';
import { AdminAuthenticationGuard } from '../guards/admin-authentication.guard';
import { AdminBrowserOriginGuard } from '../guards/admin-browser-origin.guard';
import { AdminSettingsService } from '../services/admin-settings.service';
import {
  ADMIN_REFRESH_COOKIE,
  ADMIN_REFRESH_COOKIE_PATH,
} from './admin-auth.controller';

const ADMIN_AVATAR_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES },
  fileFilter: (
    _request: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (
      !['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(
        file.mimetype,
      )
    ) {
      callback(new BadRequestException('Unsupported image format.'), false);
      return;
    }
    callback(null, true);
  },
};

@Controller('admin/settings')
@UseGuards(AdminBrowserOriginGuard, AdminAuthenticationGuard, AdminAccessGuard)
export class AdminSettingsController {
  constructor(
    private readonly settingsService: AdminSettingsService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @RequireAdminPermissions('admin.settings.read')
  overview(@Req() request: AdminAuthenticatedRequest) {
    return this.settingsService.getOverview(request.adminPrincipal!);
  }

  @Get('profile')
  @RequireAdminPermissions('admin.settings.read')
  profile(@Req() request: AdminAuthenticatedRequest) {
    return this.settingsService.getProfile(request.adminPrincipal!);
  }

  @Patch('profile')
  @RequireAdminPermissions('admin.settings.update')
  updateProfile(
    @Body() dto: UpdateAdminProfileDto,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.settingsService.updateProfile(
      request.adminPrincipal!,
      dto,
      extractLoginContext(request),
    );
  }

  @Post('profile/avatar')
  @RequireAdminPermissions('admin.settings.update')
  @UseInterceptors(FileInterceptor('file', ADMIN_AVATAR_UPLOAD_OPTIONS))
  uploadProfileAvatar(
    @UploadedFile() file: Express.Multer.File,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.settingsService.uploadProfileAvatar(
      request.adminPrincipal!,
      file,
      extractLoginContext(request),
    );
  }

  @Get('preferences')
  @RequireAdminPermissions('admin.settings.read')
  preferences(@Req() request: AdminAuthenticatedRequest) {
    return this.settingsService.getPreferences(request.adminPrincipal!);
  }

  @Patch('preferences')
  @RequireAdminPermissions('admin.settings.update')
  updatePreferences(
    @Body() dto: UpdateAdminPreferencesDto,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.settingsService.updatePreferences(
      request.adminPrincipal!,
      dto,
      extractLoginContext(request),
    );
  }

  @Get('security')
  @RequireAdminPermissions('admin.security.read')
  security(@Req() request: AdminAuthenticatedRequest) {
    return this.settingsService.getSecurity(request.adminPrincipal!);
  }

  @Post('security/password')
  @RequireAdminPermissions('admin.security.manage')
  changePassword(
    @Body() dto: ChangeAdminPasswordDto,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.settingsService.changePassword(
      request.adminPrincipal!,
      dto,
      extractLoginContext(request),
    );
  }

  @Post('security/2fa/setup')
  @RequireAdminPermissions('admin.security.manage')
  beginTwoFactorSetup(
    @Body() dto: BeginAdminTwoFactorSetupDto,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.settingsService.beginTwoFactorSetup(
      request.adminPrincipal!,
      dto,
    );
  }

  @Post('security/2fa/confirm')
  @RequireAdminPermissions('admin.security.manage')
  confirmTwoFactorSetup(
    @Body() dto: ConfirmAdminTwoFactorSetupDto,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.settingsService.confirmTwoFactorSetup(
      request.adminPrincipal!,
      dto,
      extractLoginContext(request),
    );
  }

  @Post('security/2fa/disable')
  @RequireAdminPermissions('admin.security.manage')
  disableTwoFactor(
    @Body() dto: DisableAdminTwoFactorDto,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.settingsService.disableTwoFactor(
      request.adminPrincipal!,
      dto.currentPassword,
      extractLoginContext(request),
    );
  }

  @Get('sessions')
  @RequireAdminPermissions('admin.sessions.read')
  sessions(@Req() request: AdminAuthenticatedRequest) {
    return this.settingsService.getSessions(request.adminPrincipal!);
  }

  @Delete('sessions/:sessionId')
  @RequireAdminPermissions('admin.sessions.revoke')
  async revokeSession(
    @Param('sessionId') sessionId: string,
    @Req() request: AdminAuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.settingsService.revokeSession(
      request.adminPrincipal!,
      sessionId,
      extractLoginContext(request),
    );
    if (result.revokedCurrentSession) {
      this.clearRefreshCookie(response);
    }
    return result;
  }

  @Post('sessions/revoke-others')
  @RequireAdminPermissions('admin.sessions.revoke')
  revokeOtherSessions(@Req() request: AdminAuthenticatedRequest) {
    return this.settingsService.revokeOtherSessionsWithAudit(
      request.adminPrincipal!,
      extractLoginContext(request),
    );
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
