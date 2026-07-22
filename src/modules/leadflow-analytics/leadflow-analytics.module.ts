import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmOpportunityEntity } from '../crm/entities/crm-opportunity.entity';
import { CrmOpportunityEventEntity } from '../crm/entities/crm-opportunity-event.entity';
import { CrmPipelineEntity } from '../crm/entities/crm-pipeline.entity';
import { CrmStageEntity } from '../crm/entities/crm-stage.entity';
import { InboxConversationEventEntity } from '../inbox/entities/inbox-conversation-event.entity';
import { PermissionsModule } from '../permissions';
import { LeadFlowAnalyticsController } from './leadflow-analytics.controller';
import { LeadFlowAnalyticsService } from './services/leadflow-analytics.service';

@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        CrmOpportunityEntity,
        CrmOpportunityEventEntity,
        CrmPipelineEntity,
        CrmStageEntity,
        InboxConversationEventEntity,
      ],
      'agency',
    ),
  ],
  controllers: [LeadFlowAnalyticsController],
  providers: [LeadFlowAnalyticsService],
  exports: [LeadFlowAnalyticsService],
})
export class LeadFlowAnalyticsModule {}
