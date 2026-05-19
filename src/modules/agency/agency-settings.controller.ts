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
  PatchAgencyUserPreferencesDto,
  PatchAgencyUserProfileDto,
  PatchAgencyUserSecurityDto,
  PatchAgencyWorkspaceCompanyDto,
  PatchAgencyWorkspaceUserAccessDto,
  SetupAgencyTwoFactorDto,
} from './dto/agency-settings.dto';
import { AgencySettingsService } from './agency-settings.service';

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

@UseGuards(JwtAuthGuard)
@Controller('agency/settings')
export class AgencySettingsController {
  constructor(private readonly agencySettingsService: AgencySettingsService) {}

  @Get('preferences')
  getPreferences(@RequestContextData() ctx: RequestContext) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.getPreferences(ctx.tenantId, ctx.userId);
  }

  @Patch('preferences')
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
  getProfile(@RequestContextData() ctx: RequestContext) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.getProfile(ctx.tenantId, ctx.userId);
  }

  @Patch('profile')
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
  getCompany(@RequestContextData() ctx: RequestContext) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.getCompany(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('company')
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
  getNotifications(@RequestContextData() ctx: RequestContext) {
    this.assertFullContext(ctx);
    return this.agencySettingsService.getNotifications(
      ctx.tenantId,
      ctx.workspaceId,
      ctx.userId,
    );
  }

  @Patch('notifications')
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
  getSecurity(@RequestContextData() ctx: RequestContext) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.getSecurity(
      ctx.tenantId,
      ctx.userId,
      ctx.sessionId,
    );
  }

  @Patch('security')
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
  disableTwoFactor(@RequestContextData() ctx: RequestContext) {
    this.assertUserContext(ctx);
    return this.agencySettingsService.disableTwoFactor(
      ctx.tenantId,
      ctx.userId,
      ctx.sessionId,
    );
  }

  @Delete('security/sessions/:sessionId')
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

  @Get('apps-integrations')
  async getAppsIntegrations(@RequestContextData() ctx: RequestContext) {
    this.assertWorkspaceContext(ctx);
    const [apps, integrations] = await Promise.all([
      this.agencySettingsService.getApps(ctx.tenantId, ctx.workspaceId),
      this.agencySettingsService.getIntegrations(ctx.tenantId, ctx.workspaceId),
    ]);

    return { apps, integrations };
  }

  @Patch('apps-integrations')
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
  getEmail(@RequestContextData() ctx: RequestContext) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.getEmail(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('email')
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
  getFinance(@RequestContextData() ctx: RequestContext) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.getFinance(ctx.tenantId, ctx.workspaceId);
  }

  @Patch('finance')
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
  getSubscriptions(@RequestContextData() ctx: RequestContext) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.getSubscriptions(
      ctx.tenantId,
      ctx.workspaceId,
    );
  }

  @Patch('subscriptions')
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
  getAdvanced(@RequestContextData() ctx: RequestContext) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.getAdvanced(
      ctx.tenantId,
      ctx.workspaceId,
    );
  }

  @Patch('advanced')
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
  getWorkspaceUsers(@RequestContextData() ctx: RequestContext) {
    this.assertFullContext(ctx);
    return this.agencySettingsService.getWorkspaceUsers(
      ctx.tenantId,
      ctx.workspaceId,
      ctx.userId,
    );
  }

  @Post('users/invite')
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
  getPermissionMatrix(@RequestContextData() ctx: RequestContext) {
    this.assertWorkspaceContext(ctx);
    return this.agencySettingsService.getPermissionMatrix(
      ctx.tenantId,
      ctx.workspaceId,
    );
  }

  @Patch('users/permission-matrix')
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
