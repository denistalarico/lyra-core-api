import { Res } from '@nestjs/common';
import type { Response } from 'express';
import { exportAuditChangesCsv } from '../services/audit-change-csv';
import { CompanyProductClientAccessGuard } from '../../clients/controllers/company-product-client-access.guard';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/decorators/authenticated-user.decorator';
import type { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import { ClientAreaMemberAccessService } from '../services/client-area-member-access.service';
import { AuditChangeService } from '../services/audit-change.service';
import {
  PutClientAreaModuleAccessDto,
  ListAuditChangesDto,
} from '../dto/client-area-access.dto';
import { CLIENT_AREA_MEMBERS_MANAGE_PERMISSION } from './client-area-members.agency.controller';

const actor = (user: AuthTokenPayload) => ({
  tenantId: user.tenantId,
  workspaceId: user.workspaceId,
  userId: user.sub,
});
@Controller('agency/clients/:clientId')
@UseGuards(JwtAuthGuard, PermissionsGuard, CompanyProductClientAccessGuard)
@RequirePermission(CLIENT_AREA_MEMBERS_MANAGE_PERMISSION)
export class ClientAreaAccessAgencyController {
  constructor(
    private readonly access: ClientAreaMemberAccessService,
    private readonly audit: AuditChangeService,
  ) {}
  @Get('companies/:companyContextId/client-area/members/:membershipId/modules')
  get(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') company: string,
    @Param('membershipId') member: string,
  ) {
    return this.access.get(actor(user), clientId, company, member);
  }
  @Put('companies/:companyContextId/client-area/members/:membershipId/modules')
  put(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') company: string,
    @Param('membershipId') member: string,
    @Body() dto: PutClientAreaModuleAccessDto,
  ) {
    return this.access.put(
      actor(user),
      clientId,
      company,
      member,
      dto.moduleLevels,
    );
  }
  @Post(
    'companies/:companyContextId/client-area/members/:membershipId/transfer-ownership',
  )
  @HttpCode(200)
  transfer(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('companyContextId') company: string,
    @Param('membershipId') member: string,
  ) {
    return this.access.transfer(actor(user), clientId, company, member);
  }
  @Get('audit-changes/export')
  async export(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Query() query: ListAuditChangesDto,
    @Res() res: Response,
  ) {
    const csv = await exportAuditChangesCsv(
      this.audit,
      {
        tenantId: user.tenantId,
        workspaceId: user.workspaceId,
        agencyClientId: clientId,
      },
      query,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="historico.csv"',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }
  @Get('audit-changes')
  list(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Query() query: ListAuditChangesDto,
  ) {
    return this.audit.list(
      {
        tenantId: user.tenantId,
        workspaceId: user.workspaceId,
        agencyClientId: clientId,
      },
      query,
    );
  }
}
