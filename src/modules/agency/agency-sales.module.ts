import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import { AgencySalesController } from './agency-sales.controller';
import { AgencySettingsModule } from './agency-settings.module';
import { AgencySalesService } from './agency-sales.service';
import { AgencySalesEventsReadService } from './agency-sales-events-read.service';
import { QuoteEntity } from '../quotes/entities/quote.entities';
import {
  AgencySalesActivityEntity,
  AgencySalesItemEntity,
  AgencySalesOpportunityEntity,
  AgencySalesOpportunityEventEntity,
  AgencySalesOpportunityItemEntity,
  AgencySalesPipelineEntity,
  AgencySalesStageEntity,
} from './entities/agency-sales.entities';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    PermissionsModule,
    // "Enviar e-mail" in the drawer goes out through the agency mailbox.
    AgencySettingsModule,
    TypeOrmModule.forFeature(
      [
        AgencySalesActivityEntity,
        AgencySalesItemEntity,
        AgencySalesPipelineEntity,
        AgencySalesStageEntity,
        AgencySalesOpportunityEntity,
        AgencySalesOpportunityItemEntity,
        AgencySalesOpportunityEventEntity,
        QuoteEntity,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [AgencySalesController],
  providers: [AgencySalesService, AgencySalesEventsReadService],
  exports: [AgencySalesService, AgencySalesEventsReadService],
})
export class AgencySalesModule {}
