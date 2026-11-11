import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequireAnyPermission } from '../permissions';
import { SocialInsightsService } from './services/social-insights.service';

/**
 * News ticker shared by the Agency Dashboard, LeadFlow and Social Overviews.
 *
 * Public headlines only — nothing tenant-scoped is read or returned — so it
 * accepts whoever can open any of those Overviews and needs no Social
 * entitlement. Agency surface only: not exposed to the Client Area.
 */
@Controller('agency/news-ticker')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NewsTickerController {
  constructor(private readonly insightsService: SocialInsightsService) {}

  @Get()
  @RequireAnyPermission(
    'agency.dashboards.view.self',
    'agency.dashboards.view.department',
    'agency.dashboards.view.agency',
    'agency.dashboards.view.executive',
    'leadflow.analytics.reports.view.operational',
    'leadflow.analytics.reports.view.full',
    'social.planner.calendar.view.client',
  )
  getTicker(@Query('businessMode') businessMode?: string) {
    const mode = typeof businessMode === 'string' && /^[a-z_]{1,64}$/.test(businessMode) ? businessMode : null;
    return this.insightsService.getNewsTicker(mode);
  }
}
