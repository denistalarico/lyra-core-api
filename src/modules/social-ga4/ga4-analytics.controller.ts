import { ClientAreaExposed } from '../client-area/client-area.decorators';
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
 * Exposed to the Client Area (`analytics` module, CA-AN1): each route has a rule
 * in `SOCIAL_CLIENT_AREA_ROUTES`, and a named `propertyId` is proven to belong
 * to the company by the `ga4Property` scope query. The sync route is not exposed.
 */
@Controller('social/analytics/ga4')
export class Ga4AnalyticsController {
  constructor(private readonly reads: Ga4AnalyticsReadService) {}

  @ClientAreaExposed('analytics')
  @Get('properties')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  properties(@RequestContextData() ctx: RequestContext) {
    return this.reads.properties(resolveCompanyAwareScope(ctx));
  }

  @ClientAreaExposed('analytics')
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

  @ClientAreaExposed('analytics')
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

  @ClientAreaExposed('analytics')
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

  @ClientAreaExposed('analytics')
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
