import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CreateTeamAttendanceEntryDto,
  TeamKioskPunchDto,
  UpdateTeamMemberAccessCodeDto,
  UpdateTeamPresenceDto,
} from '../dto';
import { TeamAttendanceService } from '../services/team-attendance.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  DangerousAction,
  PermissionsGuard,
  RequirePermission,
} from '../../permissions';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/team')
export class TeamAttendanceController {
  constructor(private readonly teamAttendanceService: TeamAttendanceService) {}

  // TODO(permissions): split self vs department attendance checks once member
  // identity-to-team-member scope evaluation exists.
  @Get('members/:id/presence')
  @RequirePermission('agency.team.attendance.view.department')
  getPresence(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.teamAttendanceService.getPresence(context, id);
  }

  @Patch('members/:id/presence')
  @RequirePermission('agency.team.member.update.department')
  updatePresence(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateTeamPresenceDto,
  ) {
    return this.teamAttendanceService.updatePresence(context, id, dto);
  }

  @Get('members/:id/attendance')
  @RequirePermission('agency.team.attendance.view.department')
  listAttendanceEntries(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.teamAttendanceService.listAttendanceEntries(context, id);
  }

  @Post('members/:id/attendance')
  @RequirePermission('agency.team.attendance.approve.department')
  createAttendanceEntry(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: CreateTeamAttendanceEntryDto,
  ) {
    return this.teamAttendanceService.createAttendanceEntry(context, id, dto);
  }

  @Delete('members/:id/attendance/:entryId')
  @DangerousAction()
  @RequirePermission('agency.team.attendance.approve.department')
  deleteAttendanceEntry(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
  ) {
    return this.teamAttendanceService.deleteAttendanceEntry(
      context,
      id,
      entryId,
    );
  }

  @Get('members/me/access-code')
  getOwnMemberAccessCodeStatus(
    @AuthorizedContext() context: AuthorizedRequestContext,
  ) {
    return this.teamAttendanceService.getOwnMemberAccessCodeStatus(context);
  }

  @Patch('members/me/access-code')
  updateOwnMemberAccessCode(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: UpdateTeamMemberAccessCodeDto,
  ) {
    return this.teamAttendanceService.updateOwnMemberAccessCode(context, dto);
  }

  @Get('members/:id/access-code')
  @RequirePermission('agency.team.member.update.department')
  getMemberAccessCodeStatus(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.teamAttendanceService.getMemberAccessCodeStatus(context, id);
  }

  @Patch('members/:id/access-code')
  @RequirePermission('agency.team.member.update.department')
  updateMemberAccessCode(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateTeamMemberAccessCodeDto,
  ) {
    return this.teamAttendanceService.updateMemberAccessCode(context, id, dto);
  }

  @Post('kiosk/punch')
  @RequirePermission('agency.team.attendance.approve.department')
  kioskPunch(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: TeamKioskPunchDto,
  ) {
    return this.teamAttendanceService.kioskPunch(context, dto);
  }
}
