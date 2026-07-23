import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { NotificationsModule } from '../notifications';
import { PermissionsModule } from '../permissions';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { SalesNotificationPublisher } from './sales-notification.publisher';
import { CrmOpportunityEntity } from './entities/crm-opportunity.entity';
import { CrmPipelineEntity } from './entities/crm-pipeline.entity';
import { CrmStageEntity } from './entities/crm-stage.entity';
import { CrmTagEntity } from './entities/crm-tag.entity';
import { CrmOpportunityTagEntity } from './entities/crm-opportunity-tag.entity';
import { CrmOpportunityEventEntity } from './entities/crm-opportunity-event.entity';
import { InboxDomainOutboxEntity } from '../inbox/entities/inbox-domain-outbox.entity';
import { InboxConversationEntity } from '../inbox/entities/inbox-conversation.entity';
import { CrmOpportunityCommandService } from './services/crm-opportunity-command.service';
import { CrmStageTransitionPolicyEntity } from './entities/crm-stage-transition-policy.entity';
import { CrmStageTransitionPolicyService } from './services/crm-stage-transition-policy.service';
import { CrmOpportunityFieldCatalogService } from './services/crm-opportunity-field-catalog.service';
import { CrmLeadScoreSnapshotEntity } from './lead-score/entities/crm-lead-score-snapshot.entity';
import { CrmLeadScoreStateEntity } from './lead-score/entities/crm-lead-score-state.entity';
import { LEAD_SCORE_POLICY_PROVIDER } from './lead-score/lead-score.types';
import { StaticLeadScorePolicyProvider } from './lead-score/policy/static-lead-score-policy.provider';
import { LeadScoreBackfillService } from './lead-score/services/lead-score-backfill.service';
import { LeadScoreEngineService } from './lead-score/services/lead-score-engine.service';
import { LeadScoreFeatureLoaderService } from './lead-score/services/lead-score-feature-loader.service';
import { LeadScoreQueryService } from './lead-score/services/lead-score-query.service';
import { InboxMessageEntity } from '../inbox/entities/inbox-message.entity';
import { LeadFlowBusinessModeTemplateEntity } from '../leadflow-settings/entities';

@Module({
  imports: [
    NotificationsModule,
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        CrmPipelineEntity,
        CrmStageEntity,
        CrmStageTransitionPolicyEntity,
        CrmOpportunityEntity,
        CrmTagEntity,
        CrmOpportunityTagEntity,
        CrmOpportunityEventEntity,
        InboxDomainOutboxEntity,
        InboxConversationEntity,
        ContactEntity,
        LeadFlowBusinessModeTemplateEntity,
        InboxMessageEntity,
        CrmLeadScoreStateEntity,
        CrmLeadScoreSnapshotEntity,
      ],
      'agency',
    ),
  ],
  controllers: [CrmController],
  providers: [
    CrmService,
    CrmOpportunityCommandService,
    CrmStageTransitionPolicyService,
    CrmOpportunityFieldCatalogService,
    LeadScoreFeatureLoaderService,
    LeadScoreEngineService,
    LeadScoreQueryService,
    LeadScoreBackfillService,
    // Behind a token so an Analytics-published provider can replace the static
    // one without touching the engine.
    {
      provide: LEAD_SCORE_POLICY_PROVIDER,
      useClass: StaticLeadScorePolicyProvider,
    },
    SalesNotificationPublisher,
  ],
  exports: [
    CrmService,
    CrmOpportunityCommandService,
    CrmStageTransitionPolicyService,
    CrmOpportunityFieldCatalogService,
    LeadScoreEngineService,
    LeadScoreQueryService,
    LeadScoreBackfillService,
    SalesNotificationPublisher,
  ],
})
export class CrmModule {}
