import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions';
import { LeadFlowEventsController } from './leadflow-events.controller';
import { LeadFlowEventCatalogService } from './services/leadflow-event-catalog.service';
import { LeadFlowEventRuntimeContractService } from './services/leadflow-event-runtime-contract.service';
import { LeadFlowEventValidationService } from './services/leadflow-event-validation.service';

/**
 * LeadFlow Event Contract module. Catalog and validation stay pure; durable
 * delivery is persisted in the shared Agency datasource and consumed by each
 * owning module.
 */
@Module({
  imports: [PermissionsModule],
  controllers: [LeadFlowEventsController],
  providers: [
    LeadFlowEventCatalogService,
    LeadFlowEventValidationService,
    LeadFlowEventRuntimeContractService,
  ],
  exports: [
    LeadFlowEventCatalogService,
    LeadFlowEventValidationService,
    LeadFlowEventRuntimeContractService,
  ],
})
export class LeadFlowEventsModule {}
