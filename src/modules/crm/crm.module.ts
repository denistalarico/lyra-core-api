import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmActivityEntity } from './entities/crm-activity.entity';
import { CrmOpportunityEntity } from './entities/crm-opportunity.entity';
import { CrmPipelineEntity } from './entities/crm-pipeline.entity';
import { CrmStageEntity } from './entities/crm-stage.entity';
import { CrmTagEntity } from './entities/crm-tag.entity';
import { CrmOpportunityTagEntity } from './entities/crm-opportunity-tag.entity';
import { CrmOpportunityEventEntity } from './entities/crm-opportunity-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CrmPipelineEntity,
      CrmStageEntity,
      CrmOpportunityEntity,
      CrmActivityEntity,
      CrmTagEntity,
      CrmOpportunityTagEntity,
      CrmOpportunityEventEntity,
    ]),
  ],
  controllers: [CrmController],
  providers: [CrmService],
  exports: [CrmService],
})
export class CrmModule {}
