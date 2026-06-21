import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

function getContextFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): RequestContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: String(headers['x-user-id'] ?? ''),
  };
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/team')
export class TeamAttendanceController {
  constructor(private readonly teamAttendanceService: TeamAttendanceService) {}

  // TODO(permissions): split self vs department attendance checks once member
  // identity-to-team-member scope evaluation exists.
  @Get('members/:id/presence')
  @RequirePermission('agency.team.attendance.view.department')
  getPresence(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamAttendanceService.getPresence(getContextFromHeaders(headers), id);
  }

  @Patch('members/:id/presence')
  @RequirePermission('agency.team.member.update.department')
  updatePresence(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTeamPresenceDto,
  ) {
    return this.teamAttendanceService.updatePresence(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Get('members/:id/attendance')
  @RequirePermission('agency.team.attendance.view.department')
  listAttendanceEntries(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamAttendanceService.listAttendanceEntries(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Post('members/:id/attendance')
  @RequirePermission('agency.team.attendance.approve.department')
  createAttendanceEntry(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: CreateTeamAttendanceEntryDto,
  ) {
    return this.teamAttendanceService.createAttendanceEntry(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Delete('members/:id/attendance/:entryId')
  @DangerousAction()
  @RequirePermission('agency.team.attendance.approve.department')
  deleteAttendanceEntry(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('entryId') entryId: string,
  ) {
    return this.teamAttendanceService.deleteAttendanceEntry(
      getContextFromHeaders(headers),
      id,
      entryId,
    );
  }

  @Patch('members/:id/access-code')
  @RequirePermission('agency.team.member.update.department')
  updateMemberAccessCode(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTeamMemberAccessCodeDto,
  ) {
    return this.teamAttendanceService.updateMemberAccessCode(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Post('kiosk/punch')
  @RequirePermission('agency.team.attendance.approve.department')
  kioskPunch(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: TeamKioskPunchDto,
  ) {
    return this.teamAttendanceService.kioskPunch(getContextFromHeaders(headers), dto);
  }
}
