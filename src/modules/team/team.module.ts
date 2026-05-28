import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  TeamDepartment,
  TeamMember,
  TeamMemberSkill,
  TeamMemberPresence,
  TeamAttendanceEntry,
  TeamSkill,
} from './entities';
import { TeamController } from './controllers/team.controller';
import { TeamAttendanceController } from './controllers/team-attendance.controller';
import { TeamService } from './services/team.service';
import { TeamAttendanceService } from './services/team-attendance.service';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        TeamDepartment,
        TeamSkill,
        TeamMember,
        TeamMemberSkill,
        TeamMemberPresence,
        TeamAttendanceEntry,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [TeamController, TeamAttendanceController],
  providers: [TeamService, TeamAttendanceService],
  exports: [TeamService, TeamAttendanceService],
})
export class TeamModule {}
