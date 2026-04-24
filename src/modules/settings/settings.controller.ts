import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
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
import { ConfirmTwoFactorDto } from './dto/confirm-two-factor.dto';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('preferences')
  async getPreferences(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.getPreferences(ctx.tenantId, ctx.userId);
  }

  @Patch('preferences')
  async patchPreferences(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchUserPreferencesDto,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.patchPreferences(ctx.tenantId, ctx.userId, dto);
  }

  @Get('ai')
  async getAi(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.getAi(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('ai')
  async patchAi(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchWorkspaceAiSettingsDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.patchAi(ctx.tenantId, ctx.workspaceId, dto);
  }

  @Get('company')
  async getCompany(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.getCompany(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('company')
  async patchCompany(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchWorkspaceCompanySettingsDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.patchCompany(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Patch('company/brand-assets')
  async patchCompanyBrandAssets(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchWorkspaceCompanyBrandAssetsDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.patchCompanyBrandAssets(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Get('profile')
  async getProfile(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.getProfile(ctx.tenantId, ctx.userId);
  }

  @Patch('profile')
  async patchProfile(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchUserProfileDto,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.patchProfile(ctx.tenantId, ctx.userId, dto);
  }

  @Patch('profile/avatar')
  async patchProfileAvatar(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchUserProfileAvatarDto,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.patchProfileAvatar(
      ctx.tenantId,
      ctx.userId,
      dto,
    );
  }

  @Get('users')
  async getWorkspaceUsers(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.getWorkspaceUsers(
      ctx.tenantId,
      ctx.workspaceId,
      ctx.userId,
    );
  }

  @Post('users/invite')
  async inviteWorkspaceUser(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: InviteWorkspaceUserDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.inviteWorkspaceUser(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Patch('users/:workspaceUserId/access')
  async patchWorkspaceUserAccess(
    @RequestContextData() ctx: RequestContext,
    @Param('workspaceUserId') workspaceUserId: string,
    @Body() dto: PatchWorkspaceUserAccessDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.patchWorkspaceUserAccess(
      ctx.tenantId,
      ctx.workspaceId,
      workspaceUserId,
      dto,
    );
  }

  @Post('users/:workspaceUserId/activate')
  async activateWorkspaceUser(
    @RequestContextData() ctx: RequestContext,
    @Param('workspaceUserId') workspaceUserId: string,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.activateWorkspaceUser(
      ctx.tenantId,
      ctx.workspaceId,
      workspaceUserId,
    );
  }

  @Post('users/:workspaceUserId/deactivate')
  async deactivateWorkspaceUser(
    @RequestContextData() ctx: RequestContext,
    @Param('workspaceUserId') workspaceUserId: string,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.deactivateWorkspaceUser(
      ctx.tenantId,
      ctx.workspaceId,
      workspaceUserId,
    );
  }

  @Post('users/:workspaceUserId/reset-password')
  async resetWorkspaceUserPassword(
    @RequestContextData() ctx: RequestContext,
    @Param('workspaceUserId') workspaceUserId: string,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.resetWorkspaceUserPassword(
      ctx.tenantId,
      ctx.workspaceId,
      workspaceUserId,
    );
  }

  @Delete('users/:workspaceUserId')
  async removeWorkspaceUser(
    @RequestContextData() ctx: RequestContext,
    @Param('workspaceUserId') workspaceUserId: string,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.removeWorkspaceUser(
      ctx.tenantId,
      ctx.workspaceId,
      workspaceUserId,
    );
  }

  @Get('email')
  async getEmail(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.getEmail(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('email')
  async patchEmail(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchWorkspaceEmailSettingsDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.patchEmail(ctx.tenantId, ctx.workspaceId, dto);
  }

  @Get('integrations')
  async getIntegrations(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.getIntegrations(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('integrations')
  async patchIntegrations(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchWorkspaceIntegrationsDto,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }

    return this.settingsService.patchIntegrations(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Get('security')
  async getSecurity(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.getSecurity(ctx.tenantId, ctx.userId);
  }

  @Patch('security/email')
  async patchSecurityEmail(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchSecurityEmailDto,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.patchSecurityEmail(
      ctx.tenantId,
      ctx.userId,
      dto,
    );
  }

  @Patch('security/password')
  async patchSecurityPassword(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchSecurityPasswordDto,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.patchSecurityPassword(
      ctx.tenantId,
      ctx.userId,
      dto,
    );
  }

  @Post('security/2fa/setup')
  async setupTwoFactor(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.setupTwoFactor(ctx.tenantId, ctx.userId);
  }

  @Post('security/2fa/confirm')
  async confirmTwoFactor(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: ConfirmTwoFactorDto,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.confirmTwoFactor(ctx.tenantId, ctx.userId, dto);
  }

  @Post('security/2fa/disable')
  async disableTwoFactor(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.disableTwoFactor(ctx.tenantId, ctx.userId);
  }

  @Get('security/sessions')
  async getSecuritySessions(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.getSecuritySessions(ctx.tenantId, ctx.userId);
  }

  @Post('security/sessions/:sessionId/revoke')
  async revokeSecuritySession(
    @RequestContextData() ctx: RequestContext,
    @Param('sessionId') sessionId: string,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.revokeSecuritySession(
      ctx.tenantId,
      ctx.userId,
      sessionId,
    );
  }

  @Post('security/sessions/revoke-others')
  async revokeOtherSecuritySessions(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.revokeOtherSecuritySessions(
      ctx.tenantId,
      ctx.userId,
    );
  }

  @Get('security/devices')
  async getTrustedDevices(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.getTrustedDevices(ctx.tenantId, ctx.userId);
  }

  @Post('security/devices/:deviceId/trust')
  async trustDevice(
    @RequestContextData() ctx: RequestContext,
    @Param('deviceId') deviceId: string,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.trustDevice(ctx.tenantId, ctx.userId, deviceId);
  }

  @Post('security/devices/:deviceId/remove')
  async removeTrustedDevice(
    @RequestContextData() ctx: RequestContext,
    @Param('deviceId') deviceId: string,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.removeTrustedDevice(
      ctx.tenantId,
      ctx.userId,
      deviceId,
    );
  }

  @Get('notifications')
  async getNotifications(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.getNotifications(ctx.tenantId, ctx.userId);
  }

  @Post('notifications/:notificationId/read')
  async markNotificationAsRead(
    @RequestContextData() ctx: RequestContext,
    @Param('notificationId') notificationId: string,
  ) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.markNotificationAsRead(
      ctx.tenantId,
      ctx.userId,
      notificationId,
    );
  }

  @Post('notifications/read-all')
  async markAllNotificationsAsRead(@RequestContextData() ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }

    return this.settingsService.markAllNotificationsAsRead(
      ctx.tenantId,
      ctx.userId,
    );
  }
}
