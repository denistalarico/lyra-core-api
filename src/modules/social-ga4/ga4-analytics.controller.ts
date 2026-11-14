import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import {
  Ga4BreakdownQueryDto,
  Ga4PeriodQueryDto,
  Ga4PropertyQueryDto,
} from './dto/ga4-query.dto';
import { Ga4AnalyticsReadService } from './ga4-analytics-read.service';

/** Same key as `SocialAnalyticsController`: aggregated numbers, operational. */
const SOCIAL_ANALYTICS_READ_PERMISSION =
  'social.analytics.reports.view.operational';

/**
 * Read-only reporting over the local GA4 mirror. No handler reaches Google.
 *
 * Deliberately not `@ClientAreaExposed`: exposing a route to the Client Area
 * also requires a route rule and a subject proof for the property id (see
 * G3 Registro, divergência 1). Until that exists the routes are agency-only,
 * which fails closed.
 */
@Controller('social/analytics/ga4')
export class Ga4AnalyticsController {
  constructor(private readonly reads: Ga4AnalyticsReadService) {}

  @Get('properties')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  properties(@RequestContextData() ctx: RequestContext) {
    return this.reads.properties(resolveCompanyAwareScope(ctx));
  }

  @Get('overview')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  overview(
    @RequestContextData() ctx: RequestContext,
    @Query() query: Ga4PeriodQueryDto,
  ) {
    return this.reads.overview(resolveCompanyAwareScope(ctx), query);
  }

  @Get('timeseries')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  timeseries(
    @RequestContextData() ctx: RequestContext,
    @Query() query: Ga4PeriodQueryDto,
  ) {
    return this.reads.timeseries(resolveCompanyAwareScope(ctx), query);
  }

  @Get('breakdown')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  breakdown(
    @RequestContextData() ctx: RequestContext,
    @Query() query: Ga4BreakdownQueryDto,
  ) {
    return this.reads.breakdown(resolveCompanyAwareScope(ctx), query);
  }

  @Get('freshness')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  freshness(
    @RequestContextData() ctx: RequestContext,
    @Query() query: Ga4PropertyQueryDto,
  ) {
    return this.reads.freshness(
      resolveCompanyAwareScope(ctx),
      query.propertyId,
    );
  }
}
