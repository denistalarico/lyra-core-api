import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmOpportunityEntity } from '../crm/entities/crm-opportunity.entity';
import { CrmOpportunityEventEntity } from '../crm/entities/crm-opportunity-event.entity';
import { CrmPipelineEntity } from '../crm/entities/crm-pipeline.entity';
import { CrmStageEntity } from '../crm/entities/crm-stage.entity';
import { DocumentLayoutsModule } from '../document-layouts/document-layouts.module';
import { InboxConversationEventEntity } from '../inbox/entities/inbox-conversation-event.entity';
import {
  LeadFlowAutomationEntity,
  LeadFlowAutomationRunEntity,
} from '../leadflow-automations/entities';
import { LeadFlowEventDeliveryEntity } from '../leadflow-events/entities';
import { PermissionsModule } from '../permissions';
import {
  LeadFlowCsatResponseEntity,
  LeadFlowIntelligenceConfigVersionEntity,
  LeadFlowIntelligenceDecisionEntity,
  LeadFlowIntelligenceRecommendationEntity,
  LeadFlowIntelligenceResultEntity,
} from './entities';
import { LeadFlowAnalyticsController } from './leadflow-analytics.controller';
import { LeadFlowAnalyticsEventIngressService } from './services/leadflow-analytics-event-ingress.service';
import { LeadFlowAnalyticsReportService } from './services/leadflow-analytics-report.service';
import { LeadFlowAnalyticsService } from './services/leadflow-analytics.service';
import { LeadFlowCsatService } from './services/leadflow-csat.service';
import { LeadFlowIntelligenceService } from './services/leadflow-intelligence.service';
import { LeadFlowOperationalAnalyticsService } from './services/leadflow-operational-analytics.service';

@Module({
  imports: [
    PermissionsModule,
    DocumentLayoutsModule,
    TypeOrmModule.forFeature(
      [
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
      ],
      'agency',
    ),
  ],
  controllers: [LeadFlowAnalyticsController],
  providers: [
    LeadFlowAnalyticsService,
    LeadFlowOperationalAnalyticsService,
    LeadFlowAnalyticsReportService,
    LeadFlowAnalyticsEventIngressService,
    LeadFlowCsatService,
    LeadFlowIntelligenceService,
  ],
  exports: [
    LeadFlowAnalyticsService,
    LeadFlowOperationalAnalyticsService,
    LeadFlowAnalyticsReportService,
    LeadFlowCsatService,
    LeadFlowIntelligenceService,
  ],
})
export class LeadFlowAnalyticsModule {}
