import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractsController } from './controllers/contracts.controller';
import { ContractsService } from './services/contracts.service';
import { NotificationsModule } from '../notifications';
import { ContractNotificationPublisher } from './services/contract-notification.publisher';
import {
ContractDocument,
ContractEvent,
ContractParty,
ContractRecord,
ContractTemplate,
ContractTemplateVersion,
  ContractSignatureProviderSetting,
} from './entities';

const AGENCY_CONNECTION = 'agency';

@Module({
imports: [
NotificationsModule,
TypeOrmModule.forFeature(
[
ContractTemplate,
ContractTemplateVersion,
  ContractSignatureProviderSetting,
ContractRecord,
ContractParty,
ContractDocument,
ContractEvent,
],
AGENCY_CONNECTION,
),
],
controllers: [ContractsController],
providers: [ContractsService, ContractNotificationPublisher],
exports: [ContractsService],
})
export class ContractsModule {}
