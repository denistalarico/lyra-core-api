import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyWorkspaceCompanySettingsEntity } from '../agency/entities/agency-settings.entities';
import { DocumentLayoutsModule } from '../document-layouts/document-layouts.module';
import { PermissionsModule } from '../permissions';
import {
  SocialAnalyticsDashboardEntity,
  SocialAnalyticsReportEntity,
} from './entities';
import { SocialAnalyticsDashboardsController } from './social-analytics-dashboards.controller';
import { SocialAnalyticsDashboardsService } from './social-analytics-dashboards.service';
import { SocialAnalyticsInsightsController } from './social-analytics-insights.controller';
import { SocialAnalyticsReportsController } from './social-analytics-reports.controller';
import { SocialAnalyticsInsightConfigService } from './services/social-analytics-insight-config.service';
import { SocialAnalyticsInsightProvider } from './services/social-analytics-insight.provider';
import { SocialAnalyticsInsightService } from './services/social-analytics-insight.service';
import { SocialAnalyticsReportService } from './services/social-analytics-report.service';

/**
 * Deliberately imports nothing from `social-integrations`: dashboards persist a
 * layout and never read a metric, so the dependency would only exist to share a
 * route prefix.
 *
 * The Orion insight generator (Etapa 8) lives here for the same reason its
 * controller does — it shares this module's permission and scope resolution,
 * and it reads no metric either: the numbers it analyses arrive in the request
 * body, already formatted by the cards that are showing them.
 *
 * Reports (Etapa 9) are the third resident, on the same terms: the report body
 * also arrives formatted, and the only thing read server-side is the agency
 * letterhead. `DocumentLayoutsModule` is imported for its Playwright renderer
 * — the one place in the codebase that launches a browser — rather than adding
 * a second launch path with its own production gotchas.
 */
@Module({
  imports: [
    PermissionsModule,
    DocumentLayoutsModule,
    TypeOrmModule.forFeature(
      [
        SocialAnalyticsDashboardEntity,
        SocialAnalyticsReportEntity,
        // Read-only, for the letterhead. Registered here rather than reached
        // through the agency module so this module keeps depending on entities
        // instead of on another module's services.
        AgencyWorkspaceCompanySettingsEntity,
      ],
      'agency',
    ),
  ],
  controllers: [
    SocialAnalyticsDashboardsController,
    SocialAnalyticsInsightsController,
    SocialAnalyticsReportsController,
  ],
  providers: [
    SocialAnalyticsDashboardsService,
    SocialAnalyticsInsightConfigService,
    SocialAnalyticsInsightProvider,
    SocialAnalyticsInsightService,
    SocialAnalyticsReportService,
  ],
  exports: [
    SocialAnalyticsDashboardsService,
    SocialAnalyticsInsightService,
    SocialAnalyticsReportService,
  ],
})
export class SocialAnalyticsDashboardsModule {}
