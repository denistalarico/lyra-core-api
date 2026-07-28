import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { extractLoginContext } from '../../auth/utils/login-context.util';
import { RequireAdminPermissions } from '../decorators/require-admin-permissions.decorator';
import {
  ChangeAdminInternalUserRoleDto,
  CreateAdminInvitationDto,
  ListAdminInternalUsersQueryDto,
  ListAdminInvitationsQueryDto,
} from '../dto/admin-internal-users.dto';
import {
  AdminAccessGuard,
  type AdminAuthenticatedRequest,
} from '../guards/admin-access.guard';
import { AdminAuthenticationGuard } from '../guards/admin-authentication.guard';
import { AdminBrowserOriginGuard } from '../guards/admin-browser-origin.guard';
import { AdminInternalUsersService } from '../services/admin-internal-users.service';
import { AdminInvitationsService } from '../services/admin-invitations.service';

@Controller('admin/internal-users')
@UseGuards(AdminBrowserOriginGuard, AdminAuthenticationGuard, AdminAccessGuard)
export class AdminInternalUsersController {
  constructor(
    private readonly usersService: AdminInternalUsersService,
    private readonly invitationsService: AdminInvitationsService,
  ) {}

  @Get()
  @RequireAdminPermissions('admin.internal_users.read')
  list(
    @Query() query: ListAdminInternalUsersQueryDto,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.usersService.list(request.adminPrincipal!, query);
  }

  @Get('roles')
  @RequireAdminPermissions('admin.roles.read')
  roles(@Req() request: AdminAuthenticatedRequest) {
    return this.usersService.getRoleCatalog(request.adminPrincipal!);
  }

  @Post('invitations')
  @RequireAdminPermissions('admin.internal_users.create')
  createInvitation(
    @Body() dto: CreateAdminInvitationDto,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.invitationsService.create(
      request.adminPrincipal!,
      dto,
      extractLoginContext(request),
    );
  }

  @Get('invitations')
  @RequireAdminPermissions('admin.internal_users.read')
  invitations(
    @Query() query: ListAdminInvitationsQueryDto,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.invitationsService.list(request.adminPrincipal!, query);
  }

  @Get('invitations/:invitationId')
  @RequireAdminPermissions('admin.internal_users.read')
  invitation(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.invitationsService.get(request.adminPrincipal!, invitationId);
  }

  @Post('invitations/:invitationId/resend')
  @RequireAdminPermissions('admin.internal_users.create')
  resendInvitation(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.invitationsService.resend(
      request.adminPrincipal!,
      invitationId,
      extractLoginContext(request),
    );
  }

  @Post('invitations/:invitationId/cancel')
  @RequireAdminPermissions('admin.internal_users.update')
  cancelInvitation(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.invitationsService.cancel(
      request.adminPrincipal!,
      invitationId,
      extractLoginContext(request),
    );
  }

  @Get(':adminId')
  @RequireAdminPermissions('admin.internal_users.read')
  get(
    @Param('adminId', ParseUUIDPipe) adminId: string,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.usersService.get(request.adminPrincipal!, adminId);
  }

  @Patch(':adminId/role')
  @RequireAdminPermissions('admin.internal_users.update')
  changeRole(
    @Param('adminId', ParseUUIDPipe) adminId: string,
    @Body() dto: ChangeAdminInternalUserRoleDto,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.usersService.changeRole(
      request.adminPrincipal!,
      adminId,
      dto,
      extractLoginContext(request),
    );
  }

  @Post(':adminId/suspend')
  @RequireAdminPermissions('admin.internal_users.update')
  suspend(
    @Param('adminId', ParseUUIDPipe) adminId: string,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.usersService.suspend(
      request.adminPrincipal!,
      adminId,
      extractLoginContext(request),
    );
  }

  @Post(':adminId/reactivate')
  @RequireAdminPermissions('admin.internal_users.update')
  reactivate(
    @Param('adminId', ParseUUIDPipe) adminId: string,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.usersService.reactivate(
      request.adminPrincipal!,
      adminId,
      extractLoginContext(request),
    );
  }

  @Post(':adminId/disable')
  @RequireAdminPermissions('admin.internal_users.disable')
  disable(
    @Param('adminId', ParseUUIDPipe) adminId: string,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    return this.usersService.disable(
      request.adminPrincipal!,
      adminId,
      extractLoginContext(request),
    );
  }
}
