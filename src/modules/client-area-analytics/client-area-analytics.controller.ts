import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type {
  ClientAreaContext,
  ClientAreaRequest,
} from '../client-area/client-area.types';
import { isUuid } from '../client-area/client-area.types';
import {
  ClientAreaContextData,
  RequireClientAreaModule,
  ClientAreaExposed,
} from '../client-area/client-area.decorators';
import {
  ClientAreaAuthGuard,
  ClientAreaMembershipGuard,
} from '../client-area/guards/client-area.guards';
import { toCompanyAwareScope } from '../client-area/client-area-scope';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireClientAccess,
  RequireProductEntitlement,
} from '../permissions';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import {
  ClientAreaDashboardsService,
  type DashboardActor,
} from './client-area-dashboards.service';
import { ClientAreaOverviewService } from './client-area-overview.service';
import { ClientAreaMetricDataService } from './client-area-metric-data.service';
import {
  CreateClientAreaDashboardDto,
  UpdateClientAreaDashboardDto,
  DuplicateClientAreaDashboardDto,
  ClientAreaAnalyticsReadDto,
} from './client-area-analytics.dto';
export const CLIENT_AREA_METRIC_READ_PERMISSION =
  'agency.dashboards.view.agency';
const clientActor = (context: ClientAreaContext): DashboardActor => ({
  surface: 'client_area',
  context,
});
@Controller('client-area/companies/:companyContextId/overview')
@UseGuards(ClientAreaAuthGuard, ClientAreaMembershipGuard)
@RequireClientAreaModule('overview')
export class ClientAreaOverviewController {
  constructor(private readonly overview: ClientAreaOverviewService) {}
  @Get() get(@ClientAreaContextData() context: ClientAreaContext) {
    return this.overview.get(context);
  }
}
@Controller('client-area/companies/:companyContextId/analytics/dashboards')
@UseGuards(ClientAreaAuthGuard, ClientAreaMembershipGuard)
@RequireClientAreaModule('analytics')
export class ClientAreaDashboardsController {
  constructor(private readonly dashboards: ClientAreaDashboardsService) {}
  @Get() list(@ClientAreaContextData() context: ClientAreaContext) {
    return this.dashboards.list(
      toCompanyAwareScope(context),
      clientActor(context),
    );
  }
  @Get(':id') read(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('id') id: string,
  ) {
    return this.dashboards.read(
      toCompanyAwareScope(context),
      clientActor(context),
      id,
    );
  }
  @Post() create(
    @ClientAreaContextData() context: ClientAreaContext,
    @Body() body: CreateClientAreaDashboardDto,
  ) {
    return this.dashboards.create(
      toCompanyAwareScope(context),
      clientActor(context),
      body,
    );
  }
  @Patch(':id') update(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('id') id: string,
    @Body() body: UpdateClientAreaDashboardDto,
  ) {
    return this.dashboards.update(
      toCompanyAwareScope(context),
      clientActor(context),
      id,
      body,
    );
  }
  @Delete(':id') @HttpCode(204) remove(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('id') id: string,
  ) {
    return this.dashboards.remove(
      toCompanyAwareScope(context),
      clientActor(context),
      id,
    );
  }
  @Post(':id/duplicate') duplicate(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('id') id: string,
    @Body() body: DuplicateClientAreaDashboardDto,
  ) {
    return this.dashboards.duplicate(
      toCompanyAwareScope(context),
      clientActor(context),
      id,
      body,
    );
  }
}
@Controller(
  'agency/clients/:clientId/companies/:companyContextId/client-area/analytics/dashboards',
)
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('agency.client_area.manage.admin')
@RequireClientAccess()
export class ClientAreaDashboardsAgencyController {
  constructor(private readonly dashboards: ClientAreaDashboardsService) {}
  private scope(
    ctx: RequestContext,
    clientId: string,
    companyContextId: string,
  ) {
    if (!ctx.workspaceId || !isUuid(clientId) || !isUuid(companyContextId))
      throw new NotFoundException();
    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      agencyClientId: clientId,
      companyContextId,
    };
  }
  private actor(ctx: RequestContext): DashboardActor {
    if (!ctx.userId) throw new NotFoundException();
    return { surface: 'agency', userId: ctx.userId };
  }
  @Get() list(
    @RequestContextData() ctx: RequestContext,
    @Param('clientId') client: string,
    @Param('companyContextId') company: string,
  ) {
    return this.dashboards.list(
      this.scope(ctx, client, company),
      this.actor(ctx),
    );
  }
  @Get(':id') read(
    @RequestContextData() ctx: RequestContext,
    @Param('clientId') client: string,
    @Param('companyContextId') company: string,
    @Param('id') id: string,
  ) {
    return this.dashboards.read(
      this.scope(ctx, client, company),
      this.actor(ctx),
      id,
    );
  }
  @Post() create(
    @RequestContextData() ctx: RequestContext,
    @Param('clientId') client: string,
    @Param('companyContextId') company: string,
    @Body() body: CreateClientAreaDashboardDto,
  ) {
    return this.dashboards.create(
      this.scope(ctx, client, company),
      this.actor(ctx),
      body,
    );
  }
  @Patch(':id') update(
    @RequestContextData() ctx: RequestContext,
    @Param('clientId') client: string,
    @Param('companyContextId') company: string,
    @Param('id') id: string,
    @Body() body: UpdateClientAreaDashboardDto,
  ) {
    return this.dashboards.update(
      this.scope(ctx, client, company),
      this.actor(ctx),
      id,
      body,
    );
  }
  @Delete(':id') @HttpCode(204) remove(
    @RequestContextData() ctx: RequestContext,
    @Param('clientId') client: string,
    @Param('companyContextId') company: string,
    @Param('id') id: string,
  ) {
    return this.dashboards.remove(
      this.scope(ctx, client, company),
      this.actor(ctx),
      id,
    );
  }
  @Post(':id/duplicate') duplicate(
    @RequestContextData() ctx: RequestContext,
    @Param('clientId') client: string,
    @Param('companyContextId') company: string,
    @Param('id') id: string,
    @Body() body: DuplicateClientAreaDashboardDto,
  ) {
    return this.dashboards.duplicate(
      this.scope(ctx, client, company),
      this.actor(ctx),
      id,
      body,
    );
  }
}
@Controller('agency/client-area-analytics/metrics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('agency')
export class ClientAreaMetricDataController {
  constructor(private readonly data: ClientAreaMetricDataService) {}
  @Get(':metricId')
  @RequirePermission(CLIENT_AREA_METRIC_READ_PERMISSION)
  @ClientAreaExposed('analytics')
  get(
    @RequestContextData() ctx: RequestContext,
    @Req() request: ClientAreaRequest,
    @Param('metricId') metricId: string,
    @Query() query: ClientAreaAnalyticsReadDto,
  ) {
    const to = query.to ? new Date(query.to) : new Date(),
      from = query.from
        ? new Date(query.from)
        : new Date(to.getTime() - 7 * 86400000);
    if (
      !Number.isFinite(to.getTime()) ||
      !Number.isFinite(from.getTime()) ||
      from > to ||
      to.getTime() > Date.now() + 300000 ||
      to.getTime() - from.getTime() > 366 * 86400000
    )
      throw new BadRequestException('Período inválido (máximo 366 dias).');
    const context = request.clientAreaContext;
    const scope = context
      ? toCompanyAwareScope(context)
      : resolveCompanyAwareScope(ctx);
    if (!scope.agencyClientId || !scope.companyContextId || !ctx.userId)
      throw new NotFoundException();
    return this.data.read(
      {
        ...scope,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
      },
      ctx.userId,
      metricId,
      query,
      context,
      context ? undefined : ctx,
    );
  }
}
