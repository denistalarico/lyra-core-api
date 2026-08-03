import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities';
import { AppointmentsModule } from '../appointments/appointments.module';
import { PermissionsModule } from '../permissions';
import { LeadFlowAgendaController } from './leadflow-agenda.controller';
import { LeadFlowAgendaRolloutService } from './leadflow-agenda-rollout.service';
import { LeadFlowAgendaService } from './leadflow-agenda.service';

@Module({
  imports: [AppointmentsModule, ActivitiesModule, PermissionsModule],
  controllers: [LeadFlowAgendaController],
  providers: [LeadFlowAgendaService, LeadFlowAgendaRolloutService],
  exports: [LeadFlowAgendaService],
})
export class LeadFlowAgendaModule {}
