import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyActivity } from '../activities/entities';
import { FinanceModule } from '../finance';
import { NotificationsModule } from '../notifications';
import { PermissionsModule } from '../permissions';
import { AgencyProject, AgencyTask } from '../projects/entities';
import { ClientsController } from './controllers/clients.controller';
import { AgencyClient } from './entities';
import { ClientNotificationPublisher } from './services/client-notification.publisher';
import { ClientsProfitabilityService } from './services/clients-profitability.service';
import { ClientsService } from './services/clients.service';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    FinanceModule,
    NotificationsModule,
    PermissionsModule,
    TypeOrmModule.forFeature(
      [AgencyClient, AgencyProject, AgencyTask, AgencyActivity],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [ClientsController],
  providers: [ClientsService, ClientsProfitabilityService, ClientNotificationPublisher],
  exports: [ClientsService, ClientsProfitabilityService],
})
export class ClientsModule {}
