import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CreateClientDto, ListClientsQueryDto, UpdateClientDto } from '../dto';
import { ClientsProfitabilityService } from '../services/clients-profitability.service';
import { ClientsService } from '../services/clients.service';
import {
  DangerousAction,
  PermissionsGuard,
  RequirePermission,
} from '../../permissions';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
};

function getContextFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): RequestContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: headers['x-user-id'] ? String(headers['x-user-id']) : null,
  };
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/clients')
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientsProfitabilityService: ClientsProfitabilityService,
  ) {}

  // TODO(permissions): enforce assigned/portfolio client scope once client access
  // evaluators are wired into these collection/detail routes.
  @Get()
  @RequirePermission('agency.clients.profile.view.basic.assigned')
  list(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListClientsQueryDto,
  ) {
    return this.clientsService.list(getContextFromHeaders(headers), query);
  }

  @Get('summary')
  @RequirePermission('agency.clients.profile.view.basic.assigned')
  summary(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.clientsService.summary(getContextFromHeaders(headers));
  }

  @Post()
  @RequirePermission('agency.clients.profile.create.admin')
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateClientDto,
  ) {
    return this.clientsService.create(getContextFromHeaders(headers), dto);
  }

  @Get('profitability/portfolio')
  @RequirePermission('agency.clients.profitability.view.owner_or_finance')
  getPortfolioProfitability(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.clientsProfitabilityService.getPortfolio(
      getContextFromHeaders(headers),
    );
  }

  @Get(':clientId')
  @RequirePermission('agency.clients.profile.view.basic.assigned')
  findOne(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.findOne(
      getContextFromHeaders(headers),
      clientId,
    );
  }

  @Get(':clientId/overview')
  @RequirePermission('agency.clients.profitability.view.owner_or_finance')
  getOverview(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.getOverview(
      getContextFromHeaders(headers),
      clientId,
    );
  }

  @Get(':clientId/profitability')
  @RequirePermission('agency.clients.profitability.view.owner_or_finance')
  getClientProfitability(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsProfitabilityService.getClientProfitability(
      getContextFromHeaders(headers),
      clientId,
    );
  }

  @Patch(':clientId')
  @RequirePermission('agency.clients.profile.update.assigned')
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('clientId') clientId: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientsService.update(
      getContextFromHeaders(headers),
      clientId,
      dto,
    );
  }

  @Delete(':clientId')
  @DangerousAction()
  @RequirePermission('agency.clients.profile.archive.admin')
  archive(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.archive(
      getContextFromHeaders(headers),
      clientId,
    );
  }
}
