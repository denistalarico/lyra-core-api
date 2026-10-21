import { NotificationsModule } from '../notifications/notifications.module';
import { ClientAgencyBillingNotificationsService } from './client-agency-billing-notifications.service';
import { Module } from '@nestjs/common';
import { ClientAreaModule } from '../client-area/client-area.module';
import { FinanceModule } from '../finance/finance.module';
import { ContractsModule } from '../contracts/contracts.module';
import { DocumentLayoutsModule } from '../document-layouts/document-layouts.module';
import { ClientAgencyBillingService } from './client-agency-billing.service';
import { ClientAgencyBillingController } from './client-agency-billing.controller';
@Module({
  imports: [
    NotificationsModule,
    ClientAreaModule,
    FinanceModule,
    ContractsModule,
    DocumentLayoutsModule,
  ],
  controllers: [ClientAgencyBillingController],
  exports: [ClientAgencyBillingService],
  providers: [
    ClientAgencyBillingService,
    ClientAgencyBillingNotificationsService,
  ],
})
export class ClientAgencyBillingModule {}
