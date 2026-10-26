import { GetLeadFlowTimeseriesDto } from './dto/get-leadflow-timeseries.dto';
import { LeadFlowTimeseriesService } from './services/leadflow-timeseries.service';
import {
  Body,
  Controller,
  Get,
  Delete,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClientAreaExposed } from '../client-area/client-area.decorators';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { DecideIntelligenceRecommendationDto } from './dto/decide-intelligence-recommendation.dto';
import { GenerateIntelligenceRecommendationsDto } from './dto/generate-intelligence-recommendations.dto';
import { GetCommercialJourneyAnalyticsDto } from './dto/get-commercial-journey-analytics.dto';
import { GetIntelligenceRecommendationsDto } from './dto/get-intelligence-recommendations.dto';
import { GetLeadFlowOverviewDto } from './dto/get-leadflow-overview.dto';
import { GetOperationalAnalyticsDto } from './dto/get-operational-analytics.dto';
import { UpsertAnalyticsViewDto } from './dto/upsert-analytics-view.dto';
import { LEADFLOW_ANALYTICS_PERMISSIONS } from './leadflow-analytics.permissions';
import { LeadFlowAnalyticsService } from './services/leadflow-analytics.service';
import { LeadFlowIntelligenceService } from './services/leadflow-intelligence.service';
import { LeadFlowOperationalAnalyticsService } from './services/leadflow-operational-analytics.service';
import { LeadFlowOverviewService } from './services/leadflow-overview.service';
import { LeadFlowAnalyticsViewsService } from './services/leadflow-analytics-views.service';

@Controller('leadflow/analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class LeadFlowAnalyticsController {
  constructor(
    private readonly analytics: LeadFlowAnalyticsService,
    private readonly timeseries: LeadFlowTimeseriesService,
    private readonly operationalAnalytics: LeadFlowOperationalAnalyticsService,
    private readonly overview: LeadFlowOverviewService,
    private readonly intelligence: LeadFlowIntelligenceService,
    private readonly views: LeadFlowAnalyticsViewsService,
  ) {}

  @Get('timeseries')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  getTimeseries(
    @RequestContextData() ctx: RequestContext,
    @Query() query: GetLeadFlowTimeseriesDto,
  ) {
    return this.timeseries.get(ctx, query);
  }

  @Get('views')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  listViews(@RequestContextData() ctx: RequestContext) {
    return this.views.list(ctx);
  }

  @Post('views')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  createView(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: UpsertAnalyticsViewDto,
  ) {
    return this.views.create(ctx, dto);
  }

  @Put('views/:id')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  updateView(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertAnalyticsViewDto,
  ) {
    return this.views.update(ctx, id, dto);
  }

  @Delete('views/:id')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  removeView(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.views.remove(ctx, id);
  }

  @Get('overview')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  getOverview(
    @RequestContextData() ctx: RequestContext,
    @Query() query: GetLeadFlowOverviewDto,
  ) {
    return this.overview.getOverview(ctx, query);
  }

  // OR3: the Operations Room chat KPIs reach the Client Area company-scoped
  // (`resolveCompanyAwareScope`); the bridge proves level and references.
  @ClientAreaExposed('leadflow_agents')
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

  @ClientAreaExposed('leadflow_agents')
  @Get('operational-overview')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  getOperationalOverview(
    @RequestContextData() ctx: RequestContext,
    @Query() query: GetOperationalAnalyticsDto,
  ) {
    return this.operationalAnalytics.getOverview(ctx, query);
  }

  @Get('recommendations')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  getRecommendations(
    @RequestContextData() ctx: RequestContext,
    @Query() query: GetIntelligenceRecommendationsDto,
  ) {
    return this.intelligence.list(ctx, query);
  }

  @Post('recommendations/generate')
  @RequirePermission(LEADFLOW_ANALYTICS_PERMISSIONS.recommendationsManage)
  generateRecommendations(
    @RequestContextData() ctx: RequestContext,
    @Body() query: GenerateIntelligenceRecommendationsDto,
  ) {
    return this.intelligence.generate(ctx, query);
  }

  @Post('recommendations/:id/decisions')
  @RequirePermission(LEADFLOW_ANALYTICS_PERMISSIONS.recommendationsManage)
  decideRecommendation(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() decision: DecideIntelligenceRecommendationDto,
  ) {
    return this.intelligence.decide(ctx, id, decision);
  }

  @Post('recommendations/:id/evaluate')
  @RequirePermission(LEADFLOW_ANALYTICS_PERMISSIONS.recommendationsManage)
  evaluateRecommendation(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.intelligence.evaluate(ctx, id);
  }

  @Post('recommendations/:id/rollback')
  @RequirePermission(LEADFLOW_ANALYTICS_PERMISSIONS.recommendationsManage)
  rollbackRecommendation(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.intelligence.rollback(ctx, id);
  }
}
