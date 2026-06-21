import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AgencyUserProfileEntity,
} from '../agency/entities/agency-settings.entities';
import {
  TeamDepartment,
  TeamMember,
  TeamMemberSkill,
  TeamMemberPresence,
  TeamAttendanceEntry,
  TeamSkill,
  TeamConfigOption,
  TeamPaymentBatch,
  TeamPayment,
  TeamPaymentItem,
  TeamPaymentDocument,
  TeamMemberLifecycleProcess,
  TeamMemberLifecycleStep,
} from './entities';
import { AgencyActivityLink } from '../activities/entities';
import { TeamController } from './controllers/team.controller';
import { TeamAttendanceController } from './controllers/team-attendance.controller';
import { TeamPaymentsController } from './controllers/team-payments.controller';
import { TeamLifecycleController } from './controllers/team-lifecycle.controller';
import { TeamService } from './services/team.service';
import { TeamAttendanceService } from './services/team-attendance.service';
import { TeamDashboardQueryService } from './services/team-dashboard-query.service';
import { TeamPaymentsService } from './services/team-payments.service';
import { TeamLifecycleService } from './services/team-lifecycle.service';
import { FinanceModule } from '../finance/finance.module';
import { DocumentLayoutsModule } from '../document-layouts/document-layouts.module';
import { FilesModule } from '../../common/files/files.module';
import { NotificationsModule } from '../notifications';
import { PermissionsModule } from '../permissions';
import { ContractsModule } from '../contracts/contracts.module';
import { AgencyContactsModule } from '../agency/agency-contacts.module';
import { TeamNotificationPublisher } from './services/team-notification.publisher';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    FinanceModule,
    DocumentLayoutsModule,
    FilesModule,
    NotificationsModule,
    PermissionsModule,
    ContractsModule,
    AgencyContactsModule,
    TypeOrmModule.forFeature(
      [
        TeamDepartment,
        TeamSkill,
        TeamConfigOption,
        TeamMember,
        TeamMemberSkill,
        TeamMemberPresence,
        TeamAttendanceEntry,
        TeamPaymentBatch,
        TeamPayment,
        TeamPaymentItem,
        TeamPaymentDocument,
        TeamMemberLifecycleProcess,
        TeamMemberLifecycleStep,
        AgencyUserProfileEntity,
        AgencyActivityLink,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [
    TeamController,
    TeamAttendanceController,
    TeamPaymentsController,
    TeamLifecycleController,
  ],
  providers: [
    TeamService,
    TeamAttendanceService,
    TeamPaymentsService,
    TeamLifecycleService,
    TeamDashboardQueryService,
    TeamNotificationPublisher,
  ],
  exports: [
    TeamService,
    TeamAttendanceService,
    TeamPaymentsService,
    TeamLifecycleService,
    TeamDashboardQueryService,
  ],
})
export class TeamModule {}
