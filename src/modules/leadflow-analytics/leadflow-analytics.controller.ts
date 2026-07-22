import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequireAnyPermission,
  RequireProductEntitlement,
} from '../permissions';
import { GetCommercialJourneyAnalyticsDto } from './dto/get-commercial-journey-analytics.dto';
import { LEADFLOW_ANALYTICS_PERMISSIONS } from './leadflow-analytics.permissions';
import { LeadFlowAnalyticsService } from './services/leadflow-analytics.service';

@Controller('leadflow/analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class LeadFlowAnalyticsController {
  constructor(private readonly analytics: LeadFlowAnalyticsService) {}

  @Get('commercial-journey')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  getCommercialJourney(
    @RequestContextData() ctx: RequestContext,
    @Query() query: GetCommercialJourneyAnalyticsDto,
  ) {
    return this.analytics.getCommercialJourney(ctx, query);
  }
}
