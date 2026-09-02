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
import {
  ClientProfitabilityMonthlyQueryDto,
  CreateClientDto,
  ListClientsQueryDto,
  UpdateClientDto,
  UpdateClientProductDto,
} from '../dto';
import { ClientsProfitabilityService } from '../services/clients-profitability.service';
import { ClientsService } from '../services/clients.service';
import {
  DangerousAction,
  PermissionsGuard,
  RequirePermission,
} from '../../permissions';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../../auth/decorators/authenticated-user.decorator';
import type { AuthTokenPayload } from '../../auth/types/auth-token-payload.type';

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

function getContextFromUser(user: AuthTokenPayload): RequestContext {
  return {
    tenantId: user.tenantId,
    workspaceId: user.workspaceId,
    userId: user.sub,
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
    @AuthenticatedUser() user: AuthTokenPayload,
    @Query() query: ListClientsQueryDto,
  ) {
    return this.clientsService.list(getContextFromUser(user), query);
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

  // Administrative backfill: create/link a cost center for every client that
  // does not have one yet. Declared before the `:clientId` routes.
  @Post('cost-centers/sync')
  @RequirePermission('agency.clients.profile.create.admin')
  syncCostCenters(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.clientsService.syncCostCenters(getContextFromHeaders(headers));
  }

  @Get(':clientId/cost-center')
  @RequirePermission('agency.clients.profile.view.basic.assigned')
  getCostCenter(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.getCostCenter(
      getContextFromHeaders(headers),
      clientId,
    );
  }

  @Post(':clientId/cost-center')
  @RequirePermission('agency.clients.profile.update.assigned')
  ensureCostCenter(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.ensureCostCenter(
      getContextFromHeaders(headers),
      clientId,
    );
  }

  @Get(':clientId')
  @RequirePermission('agency.clients.profile.view.basic.assigned')
  findOne(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.findOneWithProducts(
      getContextFromUser(user),
      clientId,
    );
  }

  @Patch(':clientId/products/:productKey')
  @RequirePermission('agency.clients.products.manage.admin')
  updateProduct(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
    @Param('productKey') productKey: string,
    @Body() dto: UpdateClientProductDto,
  ) {
    return this.clientsService.updateProduct(
      getContextFromUser(user),
      clientId,
      productKey,
      dto,
    );
  }

  @Get(':clientId/overview')
  @RequirePermission('agency.clients.profitability.view.owner_or_finance')
  getOverview(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.getOverview(
      getContextFromUser(user),
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

  @Get(':clientId/profitability/monthly')
  @RequirePermission('agency.clients.profitability.view.owner_or_finance')
  getClientMonthlyProfitability(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('clientId') clientId: string,
    @Query() query: ClientProfitabilityMonthlyQueryDto,
  ) {
    return this.clientsProfitabilityService.getClientMonthlyProfitability(
      getContextFromHeaders(headers),
      clientId,
      query,
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

  @Post(':clientId/unarchive')
  @RequirePermission('agency.clients.profile.archive.admin')
  unarchive(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.unarchive(
      getContextFromHeaders(headers),
      clientId,
    );
  }

  @Delete(':clientId/permanent')
  @DangerousAction()
  @RequirePermission('agency.clients.profile.delete.owner_only')
  remove(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.remove(
      getContextFromHeaders(headers),
      clientId,
    );
  }
}
