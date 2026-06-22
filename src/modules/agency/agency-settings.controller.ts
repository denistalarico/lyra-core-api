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
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { MAX_IMAGE_UPLOAD_BYTES } from '../../common/files/files.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ConfirmAgencyTwoFactorDto,
  InviteAgencyWorkspaceUserDto,
  PatchAgencyAdvancedDto,
  PatchAgencyAppsDto,
  PatchAgencyEmailDto,
  PatchAgencyFinanceDto,
  PatchAgencyIntegrationsDto,
  PatchAgencyNotificationsDto,
  PatchAgencyPermissionMatrixDto,
  PatchAgencySubscriptionsDto,
  PatchAgencyUserPermissionOverrideDto,
  PatchAgencyUserPreferencesDto,
  PatchAgencyUserProfileDto,
  PatchAgencyUserSecurityDto,
  PatchAgencyWorkspaceCompanyDto,
  PatchAgencyWorkspaceUserAccessDto,
  SetupAgencyTwoFactorDto,
} from './dto/agency-settings.dto';
import { AgencySettingsService } from './agency-settings.service';
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
@Controller('agency/settings')
export class AgencySettingsController {
  constructor(private readonly agencySettingsService: AgencySettingsService) {}

  @Get('preferences')
  @RequirePermission('agency.settings.account.view.self')
  getPreferences(@RequestContextData() ctx: RequestContext) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.getPreferences(ctx.tenantId, ctx.userId);
  }

  @Patch('preferences')
  @RequirePermission('agency.settings.account.update.self')
  patchPreferences(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchAgencyUserPreferencesDto,
  ) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.patchPreferences(
      ctx.tenantId,
      ctx.userId,
      dto,
    );
  }

  @Get('profile')
  @RequirePermission('agency.settings.account.view.self')
  getProfile(@RequestContextData() ctx: RequestContext) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.getProfile(ctx.tenantId, ctx.userId);
  }

  @Patch('profile')
  @RequirePermission('agency.settings.account.update.self')
  patchProfile(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchAgencyUserProfileDto,
  ) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.patchProfile(
      ctx.tenantId,
      ctx.userId,
      dto,
    );
  }

  @Post('profile/avatar')
  @RequirePermission('agency.settings.account.update.self')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  uploadProfileAvatar(
    @RequestContextData() ctx: RequestContext,
    @UploadedFile() file: Express.Multer.File,
  ) {
    this.assertUserContext(ctx);
    this.assertFile(file);
    return this.agencySettingsService.uploadProfileAvatar(
      ctx.tenantId,
      ctx.userId,
      file,
    );
  }

  @Get('company')
  @RequirePermission('agency.settings.company.view.admin')
  getCompany(@RequestContextData() ctx: RequestContext) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.getCompany(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('company')
  @RequirePermission('agency.settings.company.update.admin')
  patchCompany(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchAgencyWorkspaceCompanyDto,
  ) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.patchCompany(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Post('company/logo')
  @RequirePermission('agency.settings.company.update.admin')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  uploadCompanyLogo(
    @RequestContextData() ctx: RequestContext,
    @UploadedFile() file: Express.Multer.File,
  ) {
    this.assertWorkspaceContext(ctx);
    this.assertFile(file);
    return this.agencySettingsService.uploadCompanyLogo(
      ctx.tenantId,
      ctx.workspaceId,
      file,
    );
  }

  @Post('company/avatar')
  @RequirePermission('agency.settings.company.update.admin')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  uploadCompanyAvatar(
    @RequestContextData() ctx: RequestContext,
    @UploadedFile() file: Express.Multer.File,
  ) {
    this.assertWorkspaceContext(ctx);
    this.assertFile(file);
    return this.agencySettingsService.uploadCompanyAvatar(
      ctx.tenantId,
      ctx.workspaceId,
      file,
    );
  }

  @Get('notifications')
  @RequirePermission('agency.settings.account.view.self')
  getNotifications(@RequestContextData() ctx: RequestContext) {
    this.assertFullContext(ctx);
    return this.agencySettingsService.getNotifications(
      ctx.tenantId,
      ctx.workspaceId,
      ctx.userId,
    );
  }

  @Patch('notifications')
  @RequirePermission('agency.settings.account.update.self')
  patchNotifications(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchAgencyNotificationsDto,
  ) {
    this.assertFullContext(ctx);
    return this.agencySettingsService.patchNotifications(
      ctx.tenantId,
      ctx.workspaceId,
      ctx.userId,
      dto,
    );
  }

  @Get('security')
  @RequirePermission('agency.settings.account.view.self')
  getSecurity(@RequestContextData() ctx: RequestContext) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.getSecurity(
      ctx.tenantId,
      ctx.userId,
      ctx.sessionId,
    );
  }

  @Patch('security')
  @RequirePermission('agency.settings.account.update.self')
  patchSecurity(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchAgencyUserSecurityDto,
  ) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.patchSecurity(
      ctx.tenantId,
      ctx.userId,
      dto,
      ctx.sessionId,
    );
  }

  @Post('security/2fa/setup')
  @RequirePermission('agency.settings.account.update.self')
  setupTwoFactor(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SetupAgencyTwoFactorDto,
  ) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.setupTwoFactor(
      ctx.tenantId,
      ctx.userId,
      dto,
    );
  }

  @Post('security/2fa/confirm')
  @RequirePermission('agency.settings.account.update.self')
  confirmTwoFactor(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: ConfirmAgencyTwoFactorDto,
  ) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.confirmTwoFactor(
      ctx.tenantId,
      ctx.userId,
      dto,
      ctx.sessionId,
    );
  }

  @Post('security/2fa/disable')
  @RequirePermission('agency.settings.account.update.self')
  disableTwoFactor(@RequestContextData() ctx: RequestContext) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.disableTwoFactor(
      ctx.tenantId,
      ctx.userId,
      ctx.sessionId,
    );
  }

  @Delete('security/sessions/:sessionId')
  @RequirePermission('agency.settings.account.update.self')
  revokeSecuritySession(
    @RequestContextData() ctx: RequestContext,
    @Param('sessionId') sessionId: string,
  ) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.revokeSecuritySession(
      ctx.tenantId,
      ctx.userId,
      sessionId,
      ctx.sessionId,
    );
  }

  @Delete('security/trusted-devices/:deviceId')
  @RequirePermission('agency.settings.account.update.self')
  revokeTrustedDevice(
    @RequestContextData() ctx: RequestContext,
    @Param('deviceId') deviceId: string,
  ) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.revokeTrustedDevice(
      ctx.tenantId,
      ctx.userId,
      deviceId,
      ctx.sessionId,
    );
  }

  @Post('security/trusted-devices/current')
  @RequirePermission('agency.settings.account.update.self')
  trustCurrentDevice(@RequestContextData() ctx: RequestContext) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.trustCurrentDevice(
      ctx.tenantId,
      ctx.userId,
      ctx.sessionId,
    );
  }

  @Post('security/trusted-devices/current/decline')
  @RequirePermission('agency.settings.account.update.self')
  declineDeviceTrust(@RequestContextData() ctx: RequestContext) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.declineDeviceTrust(
      ctx.tenantId,
      ctx.userId,
      ctx.sessionId,
    );
  }

  @Get('apps-integrations')
  @RequirePermission('agency.settings.apps.manage.admin')
  async getAppsIntegrations(@RequestContextData() ctx: RequestContext) {
    this.assertWorkspaceContext(ctx);
    const [apps, integrations] = await Promise.all([
      this.agencySettingsService.getApps(ctx.tenantId, ctx.workspaceId),
      this.agencySettingsService.getIntegrations(ctx.tenantId, ctx.workspaceId),
    ]);

    return { apps, integrations };
  }

  @Patch('apps-integrations')
  @RequirePermission('agency.settings.apps.manage.admin')
  patchApps(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchAgencyAppsDto,
  ) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.patchApps(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Patch('apps-integrations/integrations')
  @RequirePermission('agency.settings.integrations.manage.admin')
  patchIntegrations(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchAgencyIntegrationsDto,
  ) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.patchIntegrations(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Get('email')
  @RequirePermission('agency.settings.email.manage.admin')
  getEmail(@RequestContextData() ctx: RequestContext) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.getEmail(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('email')
  @RequirePermission('agency.settings.email.manage.admin')
  patchEmail(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchAgencyEmailDto,
  ) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.patchEmail(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Get('finance')
  @RequirePermission('agency.settings.billing.view.owner_only')
  getFinance(@RequestContextData() ctx: RequestContext) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.getFinance(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('finance')
  @DangerousAction()
  @RequirePermission('agency.settings.billing.manage.owner_only')
  patchFinance(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchAgencyFinanceDto,
  ) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.patchFinance(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Get('subscriptions')
  @RequirePermission('agency.settings.billing.view.owner_only')
  getSubscriptions(@RequestContextData() ctx: RequestContext) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.getSubscriptions(
      ctx.tenantId,
      ctx.workspaceId,
    );
  }

  @Patch('subscriptions')
  @DangerousAction()
  @RequirePermission('agency.settings.billing.manage.owner_only')
  patchSubscriptions(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchAgencySubscriptionsDto,
  ) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.patchSubscriptions(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Get('advanced')
  @RequirePermission('agency.settings.domains.manage.owner_only')
  getAdvanced(@RequestContextData() ctx: RequestContext) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.getAdvanced(
      ctx.tenantId,
      ctx.workspaceId,
    );
  }

  @Patch('advanced')
  @DangerousAction()
  @RequirePermission('agency.settings.danger_zone.manage.owner_only')
  patchAdvanced(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchAgencyAdvancedDto,
  ) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.patchAdvanced(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Get('users')
  @RequirePermission('agency.settings.users.manage.admin')
  getWorkspaceUsers(@RequestContextData() ctx: RequestContext) {
    this.assertFullContext(ctx);
    return this.agencySettingsService.getWorkspaceUsers(
      ctx.tenantId,
      ctx.workspaceId,
      ctx.userId,
    );
  }

  @Post('users/invite')
  @RequirePermission('agency.settings.users.manage.admin')
  inviteWorkspaceUser(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: InviteAgencyWorkspaceUserDto,
  ) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.inviteWorkspaceUser(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Patch('users/:workspaceUserId/access')
  @RequirePermission('agency.settings.permissions.manage.admin')
  patchWorkspaceUserAccess(
    @RequestContextData() ctx: RequestContext,
    @Param('workspaceUserId') workspaceUserId: string,
    @Body() dto: PatchAgencyWorkspaceUserAccessDto,
  ) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.patchWorkspaceUserAccess(
      ctx.tenantId,
      ctx.workspaceId,
      workspaceUserId,
      dto,
    );
  }

  @Get('users/permission-matrix')
  @RequirePermission('agency.settings.permissions.manage.admin')
  getPermissionMatrix(@RequestContextData() ctx: RequestContext) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.getPermissionMatrix(
      ctx.tenantId,
      ctx.workspaceId,
    );
  }

  @Patch('users/permission-matrix')
  @RequirePermission('agency.settings.permissions.manage.admin')
  patchPermissionMatrix(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchAgencyPermissionMatrixDto,
  ) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.patchPermissionMatrix(
      ctx.tenantId,
      ctx.workspaceId,
      dto,
    );
  }

  @Post('users/:workspaceUserId/deactivate')
  @RequirePermission('agency.settings.users.manage.admin')
  deactivateWorkspaceUser(
    @RequestContextData() ctx: RequestContext,
    @Param('workspaceUserId') workspaceUserId: string,
  ) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.deactivateWorkspaceUser(
      ctx.tenantId,
      ctx.workspaceId,
      workspaceUserId,
    );
  }

  @Get('permissions/groups')
  @RequirePermission('agency.settings.permissions.manage.admin')
  getPermissionFunctionalGroups() {
    return this.agencySettingsService.getPermissionFunctionalGroups();
  }

  @Get('users/:workspaceUserId/permissions')
  @RequirePermission('agency.settings.permissions.manage.admin')
  getWorkspaceUserPermissions(
    @RequestContextData() ctx: RequestContext,
    @Param('workspaceUserId') workspaceUserId: string,
  ) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.getWorkspaceUserPermissions(
      ctx.tenantId,
      ctx.workspaceId,
      workspaceUserId,
    );
  }

  @Post('users/:workspaceUserId/permissions/overrides')
  @RequirePermission('agency.settings.permissions.manage.admin')
  addWorkspaceUserPermissionOverride(
    @RequestContextData() ctx: RequestContext,
    @Param('workspaceUserId') workspaceUserId: string,
    @Body() dto: PatchAgencyUserPermissionOverrideDto,
  ) {
    this.assertFullContext(ctx);
    return this.agencySettingsService.addWorkspaceUserPermissionOverride(
      ctx.tenantId,
      ctx.workspaceId,
      workspaceUserId,
      ctx.userId,
      dto,
    );
  }

  @Delete('users/:workspaceUserId/permissions/overrides/:permissionKey')
  @RequirePermission('agency.settings.permissions.manage.admin')
  removeWorkspaceUserPermissionOverride(
    @RequestContextData() ctx: RequestContext,
    @Param('workspaceUserId') workspaceUserId: string,
    @Param('permissionKey') permissionKey: string,
  ) {
    this.assertFullContext(ctx);
    return this.agencySettingsService.removeWorkspaceUserPermissionOverride(
      ctx.tenantId,
      ctx.workspaceId,
      workspaceUserId,
      permissionKey,
      ctx.userId,
    );
  }

  private assertUserContext(
    ctx: RequestContext,
  ): asserts ctx is RequestContext & {
    tenantId: string;
    userId: string;
  } {
    if (!ctx.tenantId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId or userId in request context.',
      );
    }
  }

  private assertWorkspaceContext(
    ctx: RequestContext,
  ): asserts ctx is RequestContext & { tenantId: string; workspaceId: string } {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Missing tenantId or workspaceId in request context.',
      );
    }
  }

  private assertFullContext(
    ctx: RequestContext,
  ): asserts ctx is RequestContext & {
    tenantId: string;
    workspaceId: string;
    userId: string;
  } {
    if (!ctx.tenantId || !ctx.workspaceId || !ctx.userId) {
      throw new BadRequestException(
        'Missing tenantId, workspaceId or userId in request context.',
      );
    }
  }

  private assertFile(file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Missing multipart field "file".');
    }
  }
}
