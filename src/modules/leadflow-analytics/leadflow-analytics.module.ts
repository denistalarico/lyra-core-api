import { LeadFlowAnalyticsDashboardsController } from './dashboards/leadflow-analytics-dashboards.controller';
import { LeadFlowAnalyticsDashboardsService } from './dashboards/leadflow-analytics-dashboards.service';
import { LeadFlowAnalyticsDashboardEntity } from './dashboards/leadflow-analytics-dashboard.entity';
import { LeadFlowTimeseriesService } from './services/leadflow-timeseries.service';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmOpportunityEntity } from '../crm/entities/crm-opportunity.entity';
import { CrmOpportunityEventEntity } from '../crm/entities/crm-opportunity-event.entity';
import { CrmPipelineEntity } from '../crm/entities/crm-pipeline.entity';
import { CrmStageEntity } from '../crm/entities/crm-stage.entity';
import { AnalyticsReportsModule } from '../analytics-reports/analytics-reports.module';
import { FilesModule } from '../../common/files/files.module';
import { AgencyUserProfileEntity } from '../agency/entities/agency-settings.entities';
import { DocumentLayoutsModule } from '../document-layouts/document-layouts.module';
import { InboxConversationEventEntity } from '../inbox/entities/inbox-conversation-event.entity';
import { InboxModule } from '../inbox/inbox.module';
import {
  LeadFlowAutomationEntity,
  LeadFlowAutomationRunEntity,
} from '../leadflow-automations/entities';
import { LeadFlowEventDeliveryEntity } from '../leadflow-events/entities';
import { LeadFlowSettingsModule } from '../leadflow-settings/leadflow-settings.module';
import { PermissionsModule } from '../permissions';
import {
  LeadFlowCsatResponseEntity,
  LeadFlowIntelligenceConfigVersionEntity,
  LeadFlowIntelligenceDecisionEntity,
  LeadFlowIntelligenceRecommendationEntity,
  LeadFlowIntelligenceResultEntity,
  LeadFlowAnalyticsViewEntity,
  LeadFlowAnalyticsReportEntity,
} from './entities';
import { LeadFlowAttributionCohortAdapter } from './intelligence/leadflow-attribution-cohort.adapter';
import { BusinessModeDimensionAdapter } from './intelligence/business-mode-dimension.adapter';
import { LeadFlowAttributionAdapter } from './intelligence/leadflow-attribution.adapter';
import { LeadFlowIntelligenceAdapter } from './intelligence/leadflow-intelligence.adapter';
import { LeadFlowAnalyticsController } from './leadflow-analytics.controller';
import { LeadFlowAnalyticsReportsController } from './leadflow-analytics-reports.controller';
import { LeadFlowAnalyticsEventIngressService } from './services/leadflow-analytics-event-ingress.service';
import { LeadFlowAnalyticsSnapshotReportService } from './services/leadflow-analytics-snapshot-report.service';
import { LeadFlowAnalyticsService } from './services/leadflow-analytics.service';
import { LeadFlowCsatService } from './services/leadflow-csat.service';
import { LeadFlowIntelligenceService } from './services/leadflow-intelligence.service';
import { LeadFlowOperationalAnalyticsService } from './services/leadflow-operational-analytics.service';
import { LeadFlowOverviewService } from './services/leadflow-overview.service';
import { LeadFlowAnalyticsViewsService } from './services/leadflow-analytics-views.service';

@Module({
  imports: [
    PermissionsModule,
    DocumentLayoutsModule,
    // AN-LF2: the report PDF (letterhead, renderer) shared with Social.
    AnalyticsReportsModule,
    FilesModule,
    // Inbox → … → Team Chat → Orion → Analytics (OR6) closes a file-level cycle.
    forwardRef(() => InboxModule),
    LeadFlowSettingsModule,
    TypeOrmModule.forFeature(
      [
        LeadFlowAnalyticsDashboardEntity,
        CrmOpportunityEntity,
        CrmOpportunityEventEntity,
        CrmPipelineEntity,
        CrmStageEntity,
        InboxConversationEventEntity,
        LeadFlowAutomationEntity,
        LeadFlowAutomationRunEntity,
        LeadFlowEventDeliveryEntity,
        LeadFlowCsatResponseEntity,
        LeadFlowIntelligenceRecommendationEntity,
        LeadFlowIntelligenceDecisionEntity,
        LeadFlowIntelligenceConfigVersionEntity,
        LeadFlowIntelligenceResultEntity,
        LeadFlowAnalyticsViewEntity,
        LeadFlowAnalyticsReportEntity,
        AgencyUserProfileEntity,
      ],
      'agency',
    ),
  ],
  controllers: [
    LeadFlowAnalyticsController,
    LeadFlowAnalyticsDashboardsController,
    LeadFlowAnalyticsReportsController,
  ],
  providers: [
    LeadFlowAnalyticsDashboardsService,
    LeadFlowTimeseriesService,
    LeadFlowAnalyticsService,
    LeadFlowOperationalAnalyticsService,
    LeadFlowOverviewService,
    LeadFlowAnalyticsSnapshotReportService,
    LeadFlowAnalyticsEventIngressService,
    LeadFlowCsatService,
    LeadFlowIntelligenceService,
    LeadFlowAnalyticsViewsService,
    // The shared-contract face of this module. It adds a narrow, countable view
    // alongside the rich projections above rather than replacing them — see the
    // class doc for why the existing services were left untouched.
    LeadFlowIntelligenceAdapter,
    // I4's individual-fact face. Separate from the fact source above because
    // it answers about one conversation rather than about a period — see the
    // class doc.
    LeadFlowAttributionAdapter,
    // I4.2's cohort face. A third adapter rather than more methods on either of
    // the two above: this one is selected by a window and answers about a set,
    // which is neither the fact source's day-bucket shape nor the individual
    // port's windowless one.
    LeadFlowAttributionCohortAdapter,
    // I5's context dimension. Not a fact source: it answers about the context
    // rather than about a period, has no window or grain anywhere in its shape,
    // and exists so that Intelligence can read a LeadFlow-stored label without
    // naming a LeadFlow table — see the port doc.
    BusinessModeDimensionAdapter,
  ],
  exports: [
    LeadFlowTimeseriesService,
    LeadFlowAnalyticsService,
    LeadFlowOperationalAnalyticsService,
    LeadFlowOverviewService,
    LeadFlowCsatService,
    LeadFlowIntelligenceService,
    LeadFlowIntelligenceAdapter,
    LeadFlowAttributionAdapter,
    LeadFlowAttributionCohortAdapter,
    BusinessModeDimensionAdapter,
  ],
})
export class LeadFlowAnalyticsModule {}
