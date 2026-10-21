import { CompanyLogoRegistry } from '../../../common/client-area-bridge/company-logo.registry';
import {
  ForbiddenException,
  NotFoundException,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ListAuditChangesDto } from '../dto/client-area-access.dto';
import { AuditChangeService } from '../services/audit-change.service';
import { exportAuditChangesCsv } from '../services/audit-change-csv';
import { toCompanyAwareScope } from '../client-area-scope';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ClientAreaContextData } from '../client-area.decorators';
import type { ClientAreaContext } from '../client-area.types';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
  ClientAreaMembershipGuard,
} from '../guards/client-area.guards';
import {
  ClientAreaConsentDecisionDto,
  PutClientAreaModuleAccessDto,
} from '../dto/client-area-access.dto';
import { ClientAreaMemberAccessService } from '../services/client-area-member-access.service';
import { ClientAreaConsentService } from '../services/client-area-consent.service';

@Controller('client-area/companies/:companyContextId')
@UseGuards(
  ClientAreaEnabledGuard,
  ClientAreaAuthGuard,
  ClientAreaMembershipGuard,
)
export class ClientAreaAccessController {
  constructor(
    private readonly access: ClientAreaMemberAccessService,
    private readonly consent: ClientAreaConsentService,
    private readonly audit: AuditChangeService,
    private readonly logos: CompanyLogoRegistry,
  ) {}
  @Get('logo') async logo(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Res() res: Response,
  ) {
    const file = await this.logos.read(toCompanyAwareScope(ctx));
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    file.body.pipe(res);
  }
  @Get('consent') getConsent(@ClientAreaContextData() ctx: ClientAreaContext) {
    return this.consent.get(ctx);
  }
  @Get('consent/history') history(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Query() query: ListAuditChangesDto,
  ) {
    return this.consent.history(ctx, query.page ?? 1, query.limit ?? 50);
  }
  @Get('settings/audit-changes') changes(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Query() query: ListAuditChangesDto,
  ) {
    if (
      query.companyContextId &&
      query.companyContextId !== ctx.companyContextId
    )
      throw new NotFoundException('Company not found.');
    if (ctx.role !== 'client_owner')
      throw new ForbiddenException('Only the Owner can read change history.');
    return this.audit.list(
      toCompanyAwareScope(ctx),
      { ...query, companyContextId: ctx.companyContextId },
      true,
    );
  }
  @Get('settings/audit-changes/export') async exportChanges(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Query() query: ListAuditChangesDto,
    @Res() res: Response,
  ) {
    if (
      query.companyContextId &&
      query.companyContextId !== ctx.companyContextId
    )
      throw new NotFoundException('Company not found.');
    if (ctx.role !== 'client_owner')
      throw new ForbiddenException('Only the Owner can read change history.');
    const csv = await exportAuditChangesCsv(
      this.audit,
      toCompanyAwareScope(ctx),
      { ...query, companyContextId: ctx.companyContextId },
      true,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="historico.csv"',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }
  @Post('consent/decision')
  @HttpCode(200)
  decide(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Body() dto: ClientAreaConsentDecisionDto,
  ) {
    return this.consent.decide(ctx, dto);
  }
  @Get('settings/members') members(
    @ClientAreaContextData() ctx: ClientAreaContext,
  ) {
    return this.access.list(ctx, ctx.agencyClientId, ctx.companyContextId);
  }
  @Get('settings/members/:membershipId/modules') modules(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Param('membershipId') id: string,
  ) {
    return this.access.get(ctx, ctx.agencyClientId, ctx.companyContextId, id);
  }
  @Put('settings/members/:membershipId/modules') putModules(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Param('membershipId') id: string,
    @Body() dto: PutClientAreaModuleAccessDto,
  ) {
    return this.access.put(
      ctx,
      ctx.agencyClientId,
      ctx.companyContextId,
      id,
      dto.moduleLevels,
    );
  }
  @Post('settings/members/:membershipId/transfer-ownership')
  @HttpCode(200)
  transfer(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Param('membershipId') id: string,
  ) {
    return this.access.transfer(
      ctx,
      ctx.agencyClientId,
      ctx.companyContextId,
      id,
    );
  }
  @Post('settings/members/:membershipId/revoke')
  @HttpCode(200)
  revoke(
    @ClientAreaContextData() ctx: ClientAreaContext,
    @Param('membershipId') id: string,
  ) {
    return this.access.revoke(ctx, id);
  }
}
