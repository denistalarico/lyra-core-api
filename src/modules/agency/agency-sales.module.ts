import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencySalesController } from './agency-sales.controller';
import { AgencySalesService } from './agency-sales.service';
import { QuoteEntity } from '../quotes/entities/quote.entities';
import {
  AgencySalesActivityEntity,
  AgencySalesItemEntity,
  AgencySalesOpportunityEntity,
  AgencySalesOpportunityItemEntity,
  AgencySalesPipelineEntity,
  AgencySalesStageEntity,
} from './entities/agency-sales.entities';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        AgencySalesActivityEntity,
        AgencySalesItemEntity,
        AgencySalesPipelineEntity,
        AgencySalesStageEntity,
        AgencySalesOpportunityEntity,
        AgencySalesOpportunityItemEntity,
        QuoteEntity,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [AgencySalesController],
  providers: [AgencySalesService],
  exports: [AgencySalesService],
})
export class AgencySalesModule {}
