import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmOpportunityEntity } from './entities/crm-opportunity.entity';
import { CrmPipelineEntity } from './entities/crm-pipeline.entity';
import { CrmStageEntity } from './entities/crm-stage.entity';
import { CrmTagEntity } from './entities/crm-tag.entity';
import { CrmOpportunityTagEntity } from './entities/crm-opportunity-tag.entity';
import { CrmOpportunityEventEntity } from './entities/crm-opportunity-event.entity';

@Module({
  imports: [
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
  providers: [CrmService],
  exports: [CrmService],
})
export class CrmModule {}
