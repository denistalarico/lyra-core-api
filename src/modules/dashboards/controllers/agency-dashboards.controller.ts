import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequireAnyPermission } from '../../permissions';
import { AgencyDashboardsService } from '../services/agency-dashboards.service';

@Controller('agency/dashboards')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AgencyDashboardsController {
  constructor(private readonly dashboardsService: AgencyDashboardsService) {}

  @Get('overview')
  @RequireAnyPermission(
    'agency.dashboards.view.self',
    'agency.dashboards.view.department',
    'agency.dashboards.view.agency',
    'agency.dashboards.view.executive',
  )
  getOverview(
    @RequestContextData() context: RequestContext,
    @Query('clientId') clientId?: string,
    @Query('market') market?: string,
  ) {
    if (market !== undefined && !['US', 'BR', 'ALL'].includes(market)) {
      throw new BadRequestException('market must be US, BR or ALL.');
    }

    // TODO(permissions): split overview widgets into scoped queries for stricter
    // self/department filtering before exposing broader dashboard variants.
    return this.dashboardsService.getOverview(context, {
      clientId,
      market: market as 'US' | 'BR' | 'ALL' | undefined,
    });
  }
}
