import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities/activities.module';
import { CalendarModule } from '../calendar/calendar.module';
import { AgencySalesModule } from '../agency/agency-sales.module';
import { ClientsModule } from '../clients/clients.module';
import { FinanceModule } from '../finance/finance.module';
import { PermissionsModule } from '../permissions';
import { PlatformModule } from '../platform/platform.module';
import { ProjectsModule } from '../projects/projects.module';
import { TeamModule } from '../team/team.module';
import { AgencyDashboardsController } from './controllers/agency-dashboards.controller';
import { AgencyDashboardAccessService } from './services/agency-dashboard-access.service';
import { AgencyDashboardPrioritiesService } from './services/agency-dashboard-priorities.service';
import { AgencyDashboardsService } from './services/agency-dashboards.service';

@Module({
  imports: [
    PlatformModule,
    PermissionsModule,
    ProjectsModule,
    FinanceModule,
    ClientsModule,
    AgencySalesModule,
    ActivitiesModule,
    CalendarModule,
    TeamModule,
  ],
  controllers: [AgencyDashboardsController],
  providers: [
    AgencyDashboardAccessService,
    AgencyDashboardPrioritiesService,
    AgencyDashboardsService,
  ],
  exports: [AgencyDashboardsService],
})
export class DashboardsModule {}
