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
import { PermissionsGuard, RequirePermission } from '../../permissions';
import {
  ChangeClientAreaMemberRoleDto,
  CreateClientAreaInvitationDto,
} from '../dto/client-area.dto';
import {
  ClientAreaInvitationService,
  type ClientAreaAgencyActor,
} from '../services/client-area-invitation.service';

export const CLIENT_AREA_MEMBERS_MANAGE_PERMISSION =
  'agency.clients.client_area_members.manage.admin';

function actorFrom(user: AuthTokenPayload): ClientAreaAgencyActor {
  return {
    tenantId: user.tenantId,
    workspaceId: user.workspaceId,
    userId: user.sub,
  };
}

/**
 * CA2 — Agency management of Client Area members, always through one Company
 * Context of one Agency Client (never a global list). Tenant and workspace
 * come from the operator's verified Agency JWT; the path ids are checked
 * against them, so company A's routes cannot touch company B.
 *
 * Client Area people cannot reach this controller (their tokens fail the
 * Agency `JwtAuthGuard`), and a `client_admin` has no member management in
 * CA2.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission(CLIENT_AREA_MEMBERS_MANAGE_PERMISSION)
@Controller('agency/clients/:clientId/companies/:companyContextId/client-area')
export class ClientAreaMembersAgencyController {
  constructor(private readonly invitations: ClientAreaInvitationService) {}

  @Get('members')
  list(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
  ) {
    return this.invitations.listForCompany(
      actorFrom(user),
      clientId,
      companyContextId,
    );
  }

  @Post('invitations')
  invite(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
    @Body() dto: CreateClientAreaInvitationDto,
  ) {
    return this.invitations.invite(
      actorFrom(user),
      clientId,
      companyContextId,
      dto,
    );
  }

  @Post('invitations/:invitationId/resend')
  @HttpCode(200)
  resend(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitations.resend(
      actorFrom(user),
      clientId,
      companyContextId,
      invitationId,
    );
  }

  @Post('invitations/:invitationId/revoke')
  @HttpCode(200)
  revokeInvitation(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitations.revokeInvitation(
      actorFrom(user),
      clientId,
      companyContextId,
      invitationId,
    );
  }

  @Patch('members/:membershipId/role')
  changeRole(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: ChangeClientAreaMemberRoleDto,
  ) {
    return this.invitations.changeMemberRole(
      actorFrom(user),
      clientId,
      companyContextId,
      membershipId,
      dto.role,
    );
  }

  @Post('members/:membershipId/revoke')
  @HttpCode(200)
  revokeMember(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') companyContextId: string,
    @Param('membershipId') membershipId: string,
  ) {
    return this.invitations.revokeMember(
      actorFrom(user),
      clientId,
      companyContextId,
      membershipId,
    );
  }
}
