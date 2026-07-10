import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions';
import { LeadFlowEventsController } from './leadflow-events.controller';
import { LeadFlowEventCatalogService } from './services/leadflow-event-catalog.service';
import { LeadFlowEventRuntimeContractService } from './services/leadflow-event-runtime-contract.service';
import { LeadFlowEventValidationService } from './services/leadflow-event-validation.service';

/**
 * LeadFlow Event Contract module. Fully in-memory: no entities, no
 * migrations for data, no bus. It only documents and validates the event
 * surface that a future runtime will consume.
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
