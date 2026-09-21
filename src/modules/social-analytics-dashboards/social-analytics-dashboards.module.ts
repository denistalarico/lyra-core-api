import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import {
  SocialAnalyticsDashboardEntity,
  SocialAnalyticsReportEntity,
} from './entities';
import { SocialAnalyticsDashboardsController } from './social-analytics-dashboards.controller';
import { SocialAnalyticsDashboardsService } from './social-analytics-dashboards.service';
import { SocialAnalyticsInsightsController } from './social-analytics-insights.controller';
import { SocialAnalyticsInsightConfigService } from './services/social-analytics-insight-config.service';
import { SocialAnalyticsInsightProvider } from './services/social-analytics-insight.provider';
import { SocialAnalyticsInsightService } from './services/social-analytics-insight.service';

/**
 * Deliberately imports nothing from `social-integrations`: dashboards persist a
 * layout and never read a metric, so the dependency would only exist to share a
 * route prefix.
 *
 * The Orion insight generator (Etapa 8) lives here for the same reason its
 * controller does — it shares this module's permission and scope resolution,
 * and it reads no metric either: the numbers it analyses arrive in the request
 * body, already formatted by the cards that are showing them.
 */
@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature(
      [SocialAnalyticsDashboardEntity, SocialAnalyticsReportEntity],
      'agency',
    ),
  ],
  controllers: [
    SocialAnalyticsDashboardsController,
    SocialAnalyticsInsightsController,
  ],
  providers: [
    SocialAnalyticsDashboardsService,
    SocialAnalyticsInsightConfigService,
    SocialAnalyticsInsightProvider,
    SocialAnalyticsInsightService,
  ],
  exports: [SocialAnalyticsDashboardsService, SocialAnalyticsInsightService],
})
export class SocialAnalyticsDashboardsModule {}
