import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SettingsService } from './settings.service';
import {
  AccessControlService,
  SettingsSectionKey,
} from '../../common/access-control/access-control.service';
import { PatchUserPreferencesDto } from './dto/patch-user-preferences.dto';
import { PatchWorkspaceAiSettingsDto } from './dto/patch-workspace-ai-settings.dto';
import { PatchWorkspaceCompanySettingsDto } from './dto/patch-workspace-company-settings.dto';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { PatchWorkspaceCompanyBrandAssetsDto } from './dto/patch-workspace-company-brand-assets.dto';
import { PatchUserProfileDto } from './dto/patch-user-profile.dto';
import { PatchUserProfileAvatarDto } from './dto/patch-user-profile-avatar.dto';
import { InviteWorkspaceUserDto } from './dto/invite-workspace-user.dto';
import { PatchWorkspaceUserAccessDto } from './dto/patch-workspace-user-access.dto';
import { PatchWorkspaceEmailSettingsDto } from './dto/patch-workspace-email-settings.dto';
import { PatchWorkspaceIntegrationsDto } from './dto/patch-workspace-integrations.dto';
import { PatchSecurityEmailDto } from './dto/patch-security-email.dto';
import { PatchSecurityPasswordDto } from './dto/patch-security-password.dto';
import { PatchSecuritySettingsDto } from './dto/patch-security-settings.dto';
import {
  ConfirmTwoFactorDto,
  SetupTwoFactorDto,
} from './dto/confirm-two-factor.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MAX_IMAGE_UPLOAD_BYTES } from '../../common/files/files.service';
import {
  DangerousAction,
  PermissionsGuard,
  RequirePermission,
} from '../permissions';

const IMAGE_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES,
  },
  fileFilter: (
    _request: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const allowedMimeTypes = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ]);

    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new BadRequestException('Unsupported image format.'), false);
      return;
    }

    callback(null, true);
  },
};

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly accessControlService: AccessControlService,
  ) {}

  @Get('preferences')
  @RequirePermission('agency.settings.account.view.self')
  async getPreferences(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'preferences');

    return this.settingsService.getPreferences(ctx.tenantId, ctx.userId);
  }

  @Patch('preferences')
  @RequirePermission('agency.settings.account.update.self')
  async patchPreferences(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchUserPreferencesDto,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'preferences');

    return this.settingsService.patchPreferences(ctx.tenantId, ctx.userId, dto);
  }

  @Get('ai')
  @RequirePermission('agency.settings.apps.manage.admin')
  async getAi(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'ai');

    return this.settingsService.getAi(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('ai')
  @RequirePermission('agency.settings.apps.manage.admin')
  async patchAi(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchWorkspaceAiSettingsDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'ai');

    return this.settingsService.patchAi(ctx.tenantId, ctx.workspaceId, dto);
  }

  @Get('company')
  @RequirePermission('agency.settings.company.view.admin')
  async getCompany(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'company');

    return this.settingsService.getCompany(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('company')
  @RequirePermission('agency.settings.company.update.admin')
  async patchCompany(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchWorkspaceCompanySettingsDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'company');

    return this.settingsService.patchCompany(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Patch('company/brand-assets')
  @RequirePermission('agency.settings.company.update.admin')
  async patchCompanyBrandAssets(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchWorkspaceCompanyBrandAssetsDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'company');

    return this.settingsService.patchCompanyBrandAssets(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Post('company/logo')
  @RequirePermission('agency.settings.company.update.admin')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  async uploadCompanyLogo(
    @RequestContextData() ctx: RequestContext,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    if (!file) {
      throw new BadRequestException('Missing multipart field "file".');
    }

    await this.assertCanAccessSettingsSection(ctx, 'company');

    return this.settingsService.uploadCompanyLogo(
      ctx.tenantId,
      ctx.workspaceId,
      file,
    );
  }

  @Post('company/avatar')
  @RequirePermission('agency.settings.company.update.admin')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  async uploadCompanyAvatar(
    @RequestContextData() ctx: RequestContext,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    if (!file) {
      throw new BadRequestException('Missing multipart field "file".');
    }

    await this.assertCanAccessSettingsSection(ctx, 'company');

    return this.settingsService.uploadCompanyAvatar(
      ctx.tenantId,
      ctx.workspaceId,
      file,
    );
  }

  @Get('profile')
  @RequirePermission('agency.settings.account.view.self')
  async getProfile(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'profile');

    return this.settingsService.getProfile(ctx.tenantId, ctx.userId);
  }

  @Patch('profile')
  @RequirePermission('agency.settings.account.update.self')
  async patchProfile(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchUserProfileDto,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'profile');

    return this.settingsService.patchProfile(ctx.tenantId, ctx.userId, dto);
  }

  @Patch('profile/avatar')
  @RequirePermission('agency.settings.account.update.self')
  async patchProfileAvatar(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchUserProfileAvatarDto,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'profile');

    return this.settingsService.patchProfileAvatar(
      ctx.tenantId,
      ctx.userId,
      dto,
    );
  }

  @Post('profile/avatar')
  @RequirePermission('agency.settings.account.update.self')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  async uploadProfileAvatar(
    @RequestContextData() ctx: RequestContext,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    if (!file) {
      throw new BadRequestException('Missing multipart field "file".');
    }

    await this.assertCanAccessSettingsSection(ctx, 'profile');

    return this.settingsService.uploadProfileAvatar(
      ctx.tenantId,
      ctx.userId,
      file,
    );
  }

  @Get('users')
  @RequirePermission('agency.settings.users.manage.admin')
  async getWorkspaceUsers(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId, workspaceId or userId in request context.',
      );
    }

    await this.accessControlService.assertCanManageUsers(
      ctx.userId,
      ctx.tenantId,
      ctx.workspaceId,
    );

    return this.settingsService.getWorkspaceUsers(
      ctx.tenantId,
      ctx.workspaceId,
      ctx.userId,
    );
  }

  @Post('users/invite')
  @RequirePermission('agency.settings.users.manage.admin')
  async inviteWorkspaceUser(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: InviteWorkspaceUserDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId, workspaceId or userId in request context.',
      );
    }

    await this.accessControlService.assertCanManageUsers(
      ctx.userId,
      ctx.tenantId,
      ctx.workspaceId,
    );

    return this.settingsService.inviteWorkspaceUser(
      ctx.tenantId,
      ctx.workspaceId,
      ctx.userId,
      ctx.role,
      dto,
    );
  }

  @Post('users/invitations')
  @RequirePermission('agency.settings.users.manage.admin')
  async createWorkspaceUserInvitation(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: InviteWorkspaceUserDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId, workspaceId or userId in request context.',
      );
    }

    await this.accessControlService.assertCanManageUsers(
      ctx.userId,
      ctx.tenantId,
      ctx.workspaceId,
    );

    return this.settingsService.createWorkspaceUserInvitation(
      ctx.tenantId,
      ctx.workspaceId,
      ctx.userId,
      ctx.role,
      dto,
    );
  }

  @Get('users/invitations')
  @RequirePermission('agency.settings.users.manage.admin')
  async listWorkspaceUserInvitations(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId, workspaceId or userId in request context.',
      );
    }

    await this.accessControlService.assertCanManageUsers(
      ctx.userId,
      ctx.tenantId,
      ctx.workspaceId,
    );

    return this.settingsService.listWorkspaceUserInvitations(
      ctx.tenantId,
      ctx.workspaceId,
      ctx.userId,
      ctx.role,
    );
  }

  @Delete('users/invitations/:invitationId')
  @RequirePermission('agency.settings.users.manage.admin')
  async revokeWorkspaceUserInvitation(
    @RequestContextData() ctx: RequestContext,
    @Param('invitationId') invitationId: string,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId, workspaceId or userId in request context.',
      );
    }

    await this.accessControlService.assertCanManageUsers(
      ctx.userId,
      ctx.tenantId,
      ctx.workspaceId,
    );

    return this.settingsService.revokeWorkspaceUserInvitation(
      ctx.tenantId,
      ctx.workspaceId,
      ctx.userId,
      ctx.role,
      invitationId,
    );
  }

  @Patch('users/:workspaceUserId/access')
  @RequirePermission('agency.settings.permissions.manage.admin')
  async patchWorkspaceUserAccess(
    @RequestContextData() ctx: RequestContext,
    @Param('workspaceUserId') workspaceUserId: string,
    @Body() dto: PatchWorkspaceUserAccessDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId, workspaceId or userId in request context.',
      );
    }

    await this.accessControlService.assertCanManageUsers(
      ctx.userId,
      ctx.tenantId,
      ctx.workspaceId,
    );

    return this.settingsService.patchWorkspaceUserAccess(
      ctx.tenantId,
      ctx.workspaceId,
      workspaceUserId,
      dto,
    );
  }

  @Post('users/:workspaceUserId/activate')
  @RequirePermission('agency.settings.users.manage.admin')
  async activateWorkspaceUser(
    @RequestContextData() ctx: RequestContext,
    @Param('workspaceUserId') workspaceUserId: string,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId, workspaceId or userId in request context.',
      );
    }

    await this.accessControlService.assertCanManageUsers(
      ctx.userId,
      ctx.tenantId,
      ctx.workspaceId,
    );

    return this.settingsService.activateWorkspaceUser(
      ctx.tenantId,
      ctx.workspaceId,
      workspaceUserId,
    );
  }

  @Post('users/:workspaceUserId/deactivate')
  @RequirePermission('agency.settings.users.manage.admin')
  async deactivateWorkspaceUser(
    @RequestContextData() ctx: RequestContext,
    @Param('workspaceUserId') workspaceUserId: string,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId, workspaceId or userId in request context.',
      );
    }

    await this.accessControlService.assertCanManageUsers(
      ctx.userId,
      ctx.tenantId,
      ctx.workspaceId,
    );

    return this.settingsService.deactivateWorkspaceUser(
      ctx.tenantId,
      ctx.workspaceId,
      workspaceUserId,
    );
  }

  @Post('users/:workspaceUserId/reset-password')
  @RequirePermission('agency.settings.users.manage.admin')
  async resetWorkspaceUserPassword(
    @RequestContextData() ctx: RequestContext,
    @Param('workspaceUserId') workspaceUserId: string,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId, workspaceId or userId in request context.',
      );
    }

    await this.accessControlService.assertCanManageUsers(
      ctx.userId,
      ctx.tenantId,
      ctx.workspaceId,
    );

    return this.settingsService.resetWorkspaceUserPassword(
      ctx.tenantId,
      ctx.workspaceId,
      workspaceUserId,
    );
  }

  @Delete('users/:workspaceUserId')
  @DangerousAction()
  @RequirePermission('agency.team.users.delete.owner_only')
  async removeWorkspaceUser(
    @RequestContextData() ctx: RequestContext,
    @Param('workspaceUserId') workspaceUserId: string,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId, workspaceId or userId in request context.',
      );
    }

    await this.accessControlService.assertCanManageUsers(
      ctx.userId,
      ctx.tenantId,
      ctx.workspaceId,
    );

    return this.settingsService.removeWorkspaceUser(
      ctx.tenantId,
      ctx.workspaceId,
      workspaceUserId,
    );
  }

  @Get('email')
  @RequirePermission('agency.settings.email.manage.admin')
  async getEmail(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'email');

    return this.settingsService.getEmail(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('email')
  @RequirePermission('agency.settings.email.manage.admin')
  async patchEmail(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchWorkspaceEmailSettingsDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'email');

    return this.settingsService.patchEmail(ctx.tenantId, ctx.workspaceId, dto);
  }

  @Get('integrations')
  @RequirePermission('agency.settings.integrations.manage.admin')
  async getIntegrations(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'integrations');

    return this.settingsService.getIntegrations(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('integrations')
  @RequirePermission('agency.settings.integrations.manage.admin')
  async patchIntegrations(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchWorkspaceIntegrationsDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'integrations');

    return this.settingsService.patchIntegrations(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Get('security')
  @RequirePermission('agency.settings.account.view.self')
  async getSecurity(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.getSecurity(ctx.tenantId, ctx.userId);
  }

  @Patch('security')
  @RequirePermission('agency.settings.account.update.self')
  async patchSecurity(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchSecuritySettingsDto,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.patchSecurity(ctx.tenantId, ctx.userId, dto);
  }

  @Patch('security/email')
  @RequirePermission('agency.settings.account.update.self')
  async patchSecurityEmail(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchSecurityEmailDto,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.patchSecurityEmail(
      ctx.tenantId,
      ctx.userId,
      dto,
    );
  }

  @Patch('security/password')
  @RequirePermission('agency.settings.account.update.self')
  async patchSecurityPassword(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchSecurityPasswordDto,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.patchSecurityPassword(
      ctx.tenantId,
      ctx.userId,
      dto,
    );
  }

  @Post('security/password/reset-email')
  @RequirePermission('agency.settings.account.update.self')
  async requestSecurityPasswordReset(
    @RequestContextData() ctx: RequestContext,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.requestSecurityPasswordReset(
      ctx.tenantId,
      ctx.userId,
    );
  }

  @Post('security/2fa/setup')
  @RequirePermission('agency.settings.account.update.self')
  async setupTwoFactor(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SetupTwoFactorDto,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.setupTwoFactor(ctx.tenantId, ctx.userId, dto);
  }

  @Post('security/2fa/confirm')
  @RequirePermission('agency.settings.account.update.self')
  async confirmTwoFactor(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: ConfirmTwoFactorDto,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.confirmTwoFactor(ctx.tenantId, ctx.userId, dto);
  }

  @Post('security/2fa/disable')
  @RequirePermission('agency.settings.account.update.self')
  async disableTwoFactor(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.disableTwoFactor(ctx.tenantId, ctx.userId);
  }

  @Get('security/sessions')
  @RequirePermission('agency.settings.account.view.self')
  async getSecuritySessions(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.getSecuritySessions(ctx.tenantId, ctx.userId);
  }

  @Post('security/sessions/:sessionId/revoke')
  @RequirePermission('agency.settings.account.update.self')
  async revokeSecuritySession(
    @RequestContextData() ctx: RequestContext,
    @Param('sessionId') sessionId: string,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.revokeSecuritySession(
      ctx.tenantId,
      ctx.userId,
      sessionId,
    );
  }

  @Post('security/sessions/revoke-others')
  @RequirePermission('agency.settings.account.update.self')
  async revokeOtherSecuritySessions(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.revokeOtherSecuritySessions(
      ctx.tenantId,
      ctx.userId,
    );
  }

  @Get('security/trusted-devices')
  @RequirePermission('agency.settings.account.view.self')
  async getTrustedDevices(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.getTrustedDevices(ctx.tenantId, ctx.userId);
  }

  @Get('security/devices')
  @RequirePermission('agency.settings.account.view.self')
  async getLegacyTrustedDevices(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.getLegacyTrustedDevices(
      ctx.tenantId,
      ctx.userId,
    );
  }

  @Post('security/trusted-devices/trust-current')
  @RequirePermission('agency.settings.account.update.self')
  async trustCurrentDevice(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId || !ctx.sessionId) {
      throw new BadRequestException(
        'Missing tenantId, userId or sessionId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.trustCurrentDevice(
      ctx.tenantId,
      ctx.userId,
      ctx.sessionId,
    );
  }

  @Post('security/devices/:deviceId/trust')
  @RequirePermission('agency.settings.account.update.self')
  async trustLegacyDevice(
    @RequestContextData() ctx: RequestContext,
    @Param('deviceId') deviceId: string,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.trustLegacyDevice(
      ctx.tenantId,
      ctx.userId,
      deviceId,
    );
  }

  @Delete('security/trusted-devices/:deviceId')
  @RequirePermission('agency.settings.account.update.self')
  async revokeTrustedDevice(
    @RequestContextData() ctx: RequestContext,
    @Param('deviceId') deviceId: string,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    return this.settingsService.revokeTrustedDevice(
      ctx.tenantId,
      ctx.userId,
      deviceId,
    );
  }

  @Post('security/devices/:deviceId/remove')
  @RequirePermission('agency.settings.account.update.self')
  async removeLegacyTrustedDevice(
    @RequestContextData() ctx: RequestContext,
    @Param('deviceId') deviceId: string,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'security');

    await this.settingsService.revokeTrustedDevice(
      ctx.tenantId,
      ctx.userId,
      deviceId,
    );

    return this.settingsService.getLegacyTrustedDevices(
      ctx.tenantId,
      ctx.userId,
    );
  }

  @Get('notifications')
  @RequirePermission('agency.settings.account.view.self')
  async getNotifications(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'notifications');

    return this.settingsService.getNotifications(ctx.tenantId, ctx.userId);
  }

  @Post('notifications/:notificationId/read')
  @RequirePermission('agency.settings.account.update.self')
  async markNotificationAsRead(
    @RequestContextData() ctx: RequestContext,
    @Param('notificationId') notificationId: string,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'notifications');

    return this.settingsService.markNotificationAsRead(
      ctx.tenantId,
      ctx.userId,
      notificationId,
    );
  }

  @Post('notifications/read-all')
  @RequirePermission('agency.settings.account.update.self')
  async markAllNotificationsAsRead(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    await this.assertCanAccessSettingsSection(ctx, 'notifications');

    return this.settingsService.markAllNotificationsAsRead(
      ctx.tenantId,
      ctx.userId,
    );
  }

  private async assertCanAccessSettingsSection(
    ctx: RequestContext,
    sectionKey: SettingsSectionKey,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId, workspaceId or userId in request context.',
      );
    }

    await this.accessControlService.assertCanAccessSettingsSection(
      ctx.userId,
      ctx.tenantId,
      ctx.workspaceId,
      sectionKey,
    );
  }
}
