import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/decorators/authenticated-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import { CLIENT_AREA_MANAGE_PERMISSION } from '../../client-area/agency/client-area-management.agency.controller';
import { ClientAreaManagementService } from '../../client-area/services/client-area-management.service';
import {
  PermissionsGuard,
  RequireClientAccess,
  RequirePermission,
} from '../../permissions';
import { ClientApprovalsService } from './client-approvals.service';

/**
 * AP3 §39–§43 — approvals inside the Agency support preview.
 *
 * WHY A SEPARATE CONTROLLER AND NOT THE CLIENT ONE
 * ------------------------------------------------
 * The actor here is the Agency operator, proven by the Agency JWT,
 * `agency.client_area.manage.admin` and `RequireClientAccess()`. No Client
 * Area token is issued, accepted or reused (§42), and the target client user
 * is never the actor of anything.
 *
 * WHY IT IS STRUCTURALLY READ-ONLY (§41)
 * --------------------------------------
 * Only `@Get` handlers exist here, and the mutation path is unreachable by
 * construction rather than by policy: every Client Area mutation requires a
 * `ClientAreaContext`, which only `ClientAreaMembershipGuard` can attach to a
 * request, and that guard runs solely on `/client-area/*` routes behind a
 * Client Area JWT. An operator in a preview has no way to produce one, so
 * there is no "don't call this" rule to forget — there is no callable target.
 *
 * FIDELITY (§43)
 * --------------
 * Both routes re-run `previewModuleScope`, which re-validates membership,
 * company, Agency app and the CRM chain on every call, and they read the
 * target membership's *own* module availability and permissions. A viewer
 * preview renders a viewer's actions, a company without the `approvals`
 * module 403s, and a revoked membership fails the very next request.
 *
 * The projection is the same `ClientApprovalsService` the real surface uses,
 * so the preview cannot drift into showing more than a client would see.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission(CLIENT_AREA_MANAGE_PERMISSION)
@Controller(
  'agency/client-area-management/clients/:clientId/companies/:companyContextId/preview/:membershipId/approvals',
)
export class ClientAreaApprovalsPreviewController {
  constructor(
    private readonly management: ClientAreaManagementService,
    private readonly approvals: ClientApprovalsService,
  ) {}

  private async resolve(
    user: AuthTokenPayload,
    clientId: string,
    companyContextId: string,
    membershipId: string,
  ) {
    const resolved = await this.management.previewModuleScope(
      user.tenantId,
      user.workspaceId,
      clientId,
      companyContextId,
      membershipId,
    );

    if (!resolved.modules.approvals) {
      throw new ForbiddenException(
        'This module is not available for the company.',
      );
    }

    return {
      scope: resolved.scope,
      reader: {
        // The target client person, used only to mark their own comments in
        // the projection. Nothing is ever written, so this is never an actor.
        userId: resolved.membership.userId,
        permissions: {
          comment: resolved.permissions.has('client_area.approvals.comment'),
          decide: resolved.permissions.has('client_area.approvals.decide'),
        },
      },
    };
  }

  @Get()
  @RequireClientAccess()
  async list(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
    @Param('membershipId') membershipId: string,
  ) {
    const { scope } = await this.resolve(
      user,
      clientId,
      companyContextId,
      membershipId,
    );
    return this.approvals.list(scope);
  }

  @Get(':approvalId')
  @RequireClientAccess()
  async detail(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
    @Param('membershipId') membershipId: string,
    @Param('approvalId', ParseUUIDPipe) approvalId: string,
  ) {
    const { scope, reader } = await this.resolve(
      user,
      clientId,
      companyContextId,
      membershipId,
    );
    return this.approvals.detail(scope, approvalId, reader);
  }
}
