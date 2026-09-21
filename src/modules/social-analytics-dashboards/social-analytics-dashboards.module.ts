import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import {
  SocialAnalyticsDashboardEntity,
  SocialAnalyticsReportEntity,
} from './entities';
import { SocialAnalyticsDashboardsController } from './social-analytics-dashboards.controller';
import { SocialAnalyticsDashboardsService } from './social-analytics-dashboards.service';

/**
 * Deliberately imports nothing from `social-integrations`: dashboards persist a
 * layout and never read a metric, so the dependency would only exist to share a
 * route prefix.
 */
@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature(
      [SocialAnalyticsDashboardEntity, SocialAnalyticsReportEntity],
      'agency',
    ),
  ],
  controllers: [SocialAnalyticsDashboardsController],
  providers: [SocialAnalyticsDashboardsService],
  exports: [SocialAnalyticsDashboardsService],
})
export class SocialAnalyticsDashboardsModule {}
