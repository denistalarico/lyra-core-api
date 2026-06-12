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
} from './entities';
import { TeamController } from './controllers/team.controller';
import { TeamAttendanceController } from './controllers/team-attendance.controller';
import { TeamPaymentsController } from './controllers/team-payments.controller';
import { TeamService } from './services/team.service';
import { TeamAttendanceService } from './services/team-attendance.service';
import { TeamDashboardQueryService } from './services/team-dashboard-query.service';
import { TeamPaymentsService } from './services/team-payments.service';
import { FinanceModule } from '../finance/finance.module';
import { DocumentLayoutsModule } from '../document-layouts/document-layouts.module';
import { FilesModule } from '../../common/files/files.module';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    FinanceModule,
    DocumentLayoutsModule,
    FilesModule,
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
        AgencyUserProfileEntity,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [TeamController, TeamAttendanceController, TeamPaymentsController],
  providers: [
    TeamService,
    TeamAttendanceService,
    TeamPaymentsService,
    TeamDashboardQueryService,
  ],
  exports: [
    TeamService,
    TeamAttendanceService,
    TeamPaymentsService,
    TeamDashboardQueryService,
  ],
})
export class TeamModule {}
