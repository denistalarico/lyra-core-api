import {
  Body,
  Controller,
  Delete,
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
  GrantClientAreaSelfAccessDto,
  PatchClientAreaCompanySettingsDto,
  PatchClientAreaSelfAccessRoleDto,
  PatchClientAreaSelfSettingsDto,
  PatchClientAreaSettingsDto,
} from '../dto/client-area-management.dto';
import { ClientAreaManagementService } from '../services/client-area-management.service';
import { ClientAreaSelfAccessService } from '../services/client-area-self-access.service';

export const CLIENT_AREA_MANAGE_PERMISSION = 'agency.client_area.manage.admin';

/** Agency-only CA3 configuration and support preview.  No Client Area token
 * is accepted here, and preview keeps the verified Agency actor. */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission(CLIENT_AREA_MANAGE_PERMISSION)
@Controller('agency/client-area-management')
export class ClientAreaManagementAgencyController {
  constructor(
    private readonly management: ClientAreaManagementService,
    private readonly selfAccess: ClientAreaSelfAccessService,
  ) {}

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

  // ------------------------------------------------- PD3 — "Minha Agência"
  //
  // The agency's own Client Area. Scoped strictly to the caller's own
  // tenant/workspace from the verified Agency token: there is no path
  // parameter to point this at another tenant (§21 case 6).

  @Get('self') selfOverview(@AuthenticatedUser() user: AuthTokenPayload) {
    return this.selfAccess.overview({
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
    });
  }

  @Patch('self')
  patchSelfSettings(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Body() dto: PatchClientAreaSelfSettingsDto,
  ) {
    return this.selfAccess.setSelfEnabled(
      { tenantId: user.tenantId, workspaceId: user.workspaceId },
      dto.selfEnabled,
      user.sub,
    );
  }

  @Post('self/access')
  @HttpCode(201)
  grantSelfAccess(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Body() dto: GrantClientAreaSelfAccessDto,
  ) {
    return this.selfAccess.grant({
      scope: { tenantId: user.tenantId, workspaceId: user.workspaceId },
      userId: dto.userId,
      role: dto.role,
      grantedByUserId: user.sub,
    });
  }

  @Patch('self/access/:userId')
  patchSelfAccessRole(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('userId') userId: string,
    @Body() dto: PatchClientAreaSelfAccessRoleDto,
  ) {
    return this.selfAccess.changeRole({
      scope: { tenantId: user.tenantId, workspaceId: user.workspaceId },
      userId,
      role: dto.role,
      actorUserId: user.sub,
    });
  }

  @Delete('self/access/:userId')
  @HttpCode(204)
  async revokeSelfAccess(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('userId') userId: string,
  ) {
    await this.selfAccess.revoke({
      scope: { tenantId: user.tenantId, workspaceId: user.workspaceId },
      userId,
      revokedByUserId: user.sub,
    });
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

  /**
   * CA3.1 — read-only refresh for the navigable preview renderer. Re-runs
   * the full authorization chain on every call (no audit row: start/end
   * already cover the audit trail) so a revoked membership or a disabled
   * Company/app fails the very next page the operator opens.
   */
  @Get(
    'clients/:clientId/companies/:companyContextId/preview/:membershipId/context',
  )
  @RequireClientAccess()
  previewContext(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
    @Param('membershipId') membershipId: string,
  ) {
    return this.management.previewContext(
      user.tenantId,
      user.workspaceId,
      clientId,
      companyContextId,
      membershipId,
    );
  }
}
