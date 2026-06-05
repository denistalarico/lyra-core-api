import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyActivity } from '../activities/entities';
import { FinanceModule } from '../finance';
import { AgencyProject, AgencyTask } from '../projects/entities';
import { ClientsController } from './controllers/clients.controller';
import { AgencyClient } from './entities';
import { ClientsProfitabilityService } from './services/clients-profitability.service';
import { ClientsService } from './services/clients.service';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    FinanceModule,
    TypeOrmModule.forFeature(
      [AgencyClient, AgencyProject, AgencyTask, AgencyActivity],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [ClientsController],
  providers: [ClientsService, ClientsProfitabilityService],
  exports: [ClientsService, ClientsProfitabilityService],
})
export class ClientsModule {}
