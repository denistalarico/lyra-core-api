import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyActivity, AgencyActivityLink } from '../activities/entities';
import { FinanceModule } from '../finance';
import { NotificationsModule } from '../notifications';
import { PermissionsModule } from '../permissions';
import { AgencyProject, AgencyTask } from '../projects/entities';
import { TeamConfigOption } from '../team/entities';
import { ClientLifecycleController } from './controllers/client-lifecycle.controller';
import { ClientsController } from './controllers/clients.controller';
import { AgencyClient, ClientLifecycleProcess, ClientLifecycleStep } from './entities';
import { ClientLifecycleService } from './services/client-lifecycle.service';
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
      [
        AgencyClient,
        AgencyProject,
        AgencyTask,
        AgencyActivity,
        AgencyActivityLink,
        TeamConfigOption,
        ClientLifecycleProcess,
        ClientLifecycleStep,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [ClientsController, ClientLifecycleController],
  providers: [
    ClientsService,
    ClientsProfitabilityService,
    ClientNotificationPublisher,
    ClientLifecycleService,
  ],
  exports: [ClientsService, ClientsProfitabilityService],
})
export class ClientsModule {}
