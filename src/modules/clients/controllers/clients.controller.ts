import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
};

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
  summary(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.clientsService.summary(context);
  }

  @Post()
  @RequirePermission('agency.clients.profile.create.admin')
  create(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateClientDto,
  ) {
    return this.clientsService.create(context, dto);
  }

  @Get('profitability/portfolio')
  @RequirePermission('agency.clients.profitability.view.owner_or_finance')
  getPortfolioProfitability(
    @AuthorizedContext() context: AuthorizedRequestContext,
  ) {
    return this.clientsProfitabilityService.getPortfolio(context);
  }

  // Administrative backfill: create/link a cost center for every client that
  // does not have one yet. Declared before the `:clientId` routes.
  @Post('cost-centers/sync')
  @RequirePermission('agency.clients.profile.create.admin')
  syncCostCenters(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.clientsService.syncCostCenters(context);
  }

  @Get(':clientId/cost-center')
  @RequirePermission('agency.clients.profile.view.basic.assigned')
  getCostCenter(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.getCostCenter(context, clientId);
  }

  @Post(':clientId/cost-center')
  @RequirePermission('agency.clients.profile.update.assigned')
  ensureCostCenter(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.ensureCostCenter(context, clientId);
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
    return this.clientsService.getOverview(getContextFromUser(user), clientId);
  }

  @Get(':clientId/profitability')
  @RequirePermission('agency.clients.profitability.view.owner_or_finance')
  getClientProfitability(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsProfitabilityService.getClientProfitability(
      context,
      clientId,
    );
  }

  @Get(':clientId/profitability/monthly')
  @RequirePermission('agency.clients.profitability.view.owner_or_finance')
  getClientMonthlyProfitability(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('clientId') clientId: string,
    @Query() query: ClientProfitabilityMonthlyQueryDto,
  ) {
    return this.clientsProfitabilityService.getClientMonthlyProfitability(
      context,
      clientId,
      query,
    );
  }

  @Patch(':clientId')
  @RequirePermission('agency.clients.profile.update.assigned')
  update(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('clientId') clientId: string,
    @Body() dto: UpdateClientDto,
  ) {
    return this.clientsService.update(context, clientId, dto);
  }

  @Delete(':clientId')
  @DangerousAction()
  @RequirePermission('agency.clients.profile.archive.admin')
  archive(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.archive(context, clientId);
  }

  @Post(':clientId/unarchive')
  @RequirePermission('agency.clients.profile.archive.admin')
  unarchive(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.unarchive(context, clientId);
  }

  @Delete(':clientId/permanent')
  @DangerousAction()
  @RequirePermission('agency.clients.profile.delete.owner_only')
  remove(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('clientId') clientId: string,
  ) {
    return this.clientsService.remove(context, clientId);
  }
}
