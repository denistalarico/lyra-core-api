import { CompanyProductsModule } from '../../common/company-products/company-products.module';
import { LeadFlowAgendaCompanyProductParticipant } from './leadflow-agenda-company-product.participant';
import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities';
import { AppointmentsModule } from '../appointments/appointments.module';
import { PermissionsModule } from '../permissions';
import { LeadFlowAgendaController } from './leadflow-agenda.controller';
import { LeadFlowAgendaRolloutService } from './leadflow-agenda-rollout.service';
import { LeadFlowAgendaService } from './leadflow-agenda.service';

@Module({
  imports: [
    CompanyProductsModule,
    AppointmentsModule,
    ActivitiesModule,
    PermissionsModule,
  ],
  controllers: [LeadFlowAgendaController],
  providers: [
    LeadFlowAgendaCompanyProductParticipant,
    LeadFlowAgendaService,
    LeadFlowAgendaRolloutService,
  ],
  exports: [LeadFlowAgendaService],
})
export class LeadFlowAgendaModule {}
