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
        ContactEntity,
      ],
      'agency',
    ),
  ],
  controllers: [CrmController],
  providers: [CrmService, SalesNotificationPublisher],
  exports: [CrmService, SalesNotificationPublisher],
})
export class CrmModule {}
