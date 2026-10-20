import {
  LEADFLOW_METRIC_CATALOG,
  LEADFLOW_SECTIONS,
} from './leadflow-metric.catalog';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { resolveCompanyAwareScope } from '../../../common/context/company-aware-scope';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireAnyPermission,
  RequireProductEntitlement,
} from '../../permissions';
import {
  CreateLeadFlowAnalyticsDashboardDto,
  UpdateLeadFlowAnalyticsDashboardDto,
} from './leadflow-analytics-dashboard.dto';
import { LeadFlowAnalyticsDashboardsService } from './leadflow-analytics-dashboards.service';

/**
 * Reading a dashboard is reading a report, so it reuses the permission that
 * already governs that. Changing one is not: a dashboard is shared state for
 * the whole scope, and a manager who may read numbers should not silently
 * reshape what every colleague sees.
 */
const READ_PERMISSION = 'leadflow.analytics.reports.view.operational';
const MANAGE_PERMISSION = 'leadflow.analytics.reports.view.full';

/** Agency-only layouts; client exposure and curation belong to CA13. */
@Controller('leadflow/analytics/dashboards')
export class LeadFlowAnalyticsDashboardsController {
  constructor(private readonly service: LeadFlowAnalyticsDashboardsService) {}

  /**
   * The dashboards of the caller's context, built-in one first.
   *
   * Scope comes from the resolved managed context, never from the query: a
   * client id accepted from the caller would let any authenticated member list
   * another client's dashboards.
   */
  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('leadflow')
  @RequireAnyPermission(READ_PERMISSION, MANAGE_PERMISSION)
  async list(@RequestContextData() ctx: RequestContext) {
    const items = await this.service.list(
      resolveCompanyAwareScope(ctx),
      ctx.userId ?? null,
    );

    return {
      items,
      total: items.length,
      catalog: LEADFLOW_METRIC_CATALOG,
      sections: LEADFLOW_SECTIONS,
    };
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('leadflow')
  @RequirePermission(MANAGE_PERMISSION)
  create(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateLeadFlowAnalyticsDashboardDto,
  ) {
    return this.service.create(
      resolveCompanyAwareScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  /** A layout-only update preserves the dashboard name and channels. */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('leadflow')
  @RequirePermission(MANAGE_PERMISSION)
  update(
    @RequestContextData() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateLeadFlowAnalyticsDashboardDto,
  ) {
    return this.service.update(resolveCompanyAwareScope(ctx), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('leadflow')
  @RequirePermission(MANAGE_PERMISSION)
  async remove(
    @RequestContextData() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.service.remove(resolveCompanyAwareScope(ctx), id);
  }
}
