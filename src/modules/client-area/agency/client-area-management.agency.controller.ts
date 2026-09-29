import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/decorators/authenticated-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import {
  PermissionsGuard,
  RequireClientAccess,
  RequirePermission,
} from '../../permissions';
import {
  PatchClientAreaCompanySettingsDto,
  PatchClientAreaSettingsDto,
} from '../dto/client-area-management.dto';
import { ClientAreaManagementService } from '../services/client-area-management.service';

export const CLIENT_AREA_MANAGE_PERMISSION = 'agency.client_area.manage.admin';

/** Agency-only CA3 configuration and support preview.  No Client Area token
 * is accepted here, and preview keeps the verified Agency actor. */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission(CLIENT_AREA_MANAGE_PERMISSION)
@Controller('agency/client-area-management')
export class ClientAreaManagementAgencyController {
  constructor(private readonly management: ClientAreaManagementService) {}

  @Get() overview(@AuthenticatedUser() user: AuthTokenPayload) {
    return this.management.overview(user.tenantId, user.workspaceId);
  }
  @Get('settings') settings(@AuthenticatedUser() user: AuthTokenPayload) {
    return this.management.getSettings(user.tenantId, user.workspaceId);
  }
  @Patch('settings') patchSettings(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Body() dto: PatchClientAreaSettingsDto,
  ) {
    return this.management.patchSettings(user.tenantId, user.workspaceId, dto);
  }
  @Get('branding') branding(@AuthenticatedUser() user: AuthTokenPayload) {
    return this.management.branding(user.tenantId, user.workspaceId);
  }
  @Get('companies') companies(@AuthenticatedUser() user: AuthTokenPayload) {
    return this.management.listCompanies(user.tenantId, user.workspaceId);
  }

  @Get('clients/:clientId/companies/:companyContextId')
  @RequireClientAccess()
  companySettings(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
  ) {
    return this.management.getCompanySettings(
      user.tenantId,
      user.workspaceId,
      clientId,
      companyContextId,
    );
  }

  @Patch('clients/:clientId/companies/:companyContextId')
  @RequireClientAccess()
  patchCompanySettings(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
    @Body() dto: PatchClientAreaCompanySettingsDto,
  ) {
    return this.management.patchCompanySettings(
      user.tenantId,
      user.workspaceId,
      clientId,
      companyContextId,
      dto,
    );
  }

  @Get('clients/:clientId/companies/:companyContextId/preview-targets')
  @RequireClientAccess()
  previewTargets(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
  ) {
    return this.management.previewTargets(
      user.tenantId,
      user.workspaceId,
      clientId,
      companyContextId,
    );
  }

  @Post(
    'clients/:clientId/companies/:companyContextId/preview/:membershipId/start',
  )
  @RequireClientAccess()
  @HttpCode(200)
  startPreview(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
    @Param('membershipId') membershipId: string,
  ) {
    return this.management.preview(
      user.tenantId,
      user.workspaceId,
      clientId,
      companyContextId,
      user.sub,
      membershipId,
      'preview_started',
    );
  }

  @Post(
    'clients/:clientId/companies/:companyContextId/preview/:membershipId/end',
  )
  @RequireClientAccess()
  @HttpCode(200)
  endPreview(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
    @Param('membershipId') membershipId: string,
  ) {
    return this.management.preview(
      user.tenantId,
      user.workspaceId,
      clientId,
      companyContextId,
      user.sub,
      membershipId,
      'preview_ended',
    );
  }
}
