import { Res, ParseUUIDPipe } from '@nestjs/common';
import type { Response } from 'express';
import { CompanyLogoRegistry } from '../../../common/client-area-bridge/company-logo.registry';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/decorators/authenticated-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import {
  CreateAgencyClientCompanyContextDto,
  UpdateAgencyClientCompanyContextDto,
} from '../dto';
import { AgencyClientCompanyContextService } from '../services/agency-client-company-context.service';

function contextFromUser(user: AuthTokenPayload) {
  return {
    tenantId: user.tenantId,
    workspaceId: user.workspaceId,
    userId: user.sub,
  };
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/clients/:clientId/companies')
export class ClientCompaniesController {
  constructor(
    private readonly companyContexts: AgencyClientCompanyContextService,
    private readonly logos: CompanyLogoRegistry,
  ) {}

  @Get()
  @RequirePermission('agency.clients.profile.view.basic.assigned')
  list(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
  ) {
    return this.companyContexts.list(contextFromUser(user), clientId);
  }

  @Get(':contextId/logo')
  @RequirePermission('agency.clients.profile.view.basic.assigned')
  async logo(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId', new ParseUUIDPipe({ errorHttpStatusCode: 404 }))
    clientId: string,
    @Param('contextId', new ParseUUIDPipe({ errorHttpStatusCode: 404 }))
    companyContextId: string,
    @Res() res: Response,
  ) {
    const file = await this.logos.read({
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      agencyClientId: clientId,
      companyContextId,
    });
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    file.body.pipe(res);
  }
  @Get('options')
  @RequirePermission('agency.clients.profile.view.basic.assigned')
  listOptions(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Query('q') query?: string,
  ) {
    return this.companyContexts.listOptions(
      contextFromUser(user),
      clientId,
      query,
    );
  }

  @Post()
  @RequirePermission('agency.clients.profile.update.assigned')
  create(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Body() dto: CreateAgencyClientCompanyContextDto,
  ) {
    return this.companyContexts.create(contextFromUser(user), clientId, dto);
  }

  @Patch(':contextId')
  @RequirePermission('agency.clients.profile.update.assigned')
  update(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('contextId') contextId: string,
    @Body() dto: UpdateAgencyClientCompanyContextDto,
  ) {
    return this.companyContexts.update(
      contextFromUser(user),
      clientId,
      contextId,
      dto,
    );
  }

  @Post(':contextId/make-primary')
  @RequirePermission('agency.clients.profile.update.assigned')
  makePrimary(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('contextId') contextId: string,
  ) {
    return this.companyContexts.makePrimary(
      contextFromUser(user),
      clientId,
      contextId,
    );
  }

  @Post(':contextId/archive')
  @RequirePermission('agency.clients.profile.update.assigned')
  archive(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('contextId') contextId: string,
  ) {
    return this.companyContexts.archive(
      contextFromUser(user),
      clientId,
      contextId,
    );
  }
}
