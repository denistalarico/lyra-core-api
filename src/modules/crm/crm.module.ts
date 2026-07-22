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
import { CrmOpportunityCommandService } from './services/crm-opportunity-command.service';

@Module({
  imports: [
    NotificationsModule,
    PermissionsModule,
    TypeOrmModule.forFeature(
      [
        CrmPipelineEntity,
        CrmStageEntity,
        CrmOpportunityEntity,
        CrmTagEntity,
        CrmOpportunityTagEntity,
        CrmOpportunityEventEntity,
        InboxDomainOutboxEntity,
        ContactEntity,
      ],
      'agency',
    ),
  ],
  controllers: [CrmController],
  providers: [
    CrmService,
    CrmOpportunityCommandService,
    SalesNotificationPublisher,
  ],
  exports: [
    CrmService,
    CrmOpportunityCommandService,
    SalesNotificationPublisher,
  ],
})
export class CrmModule {}
