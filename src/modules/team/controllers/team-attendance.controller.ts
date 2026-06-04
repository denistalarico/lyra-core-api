import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CreateTeamAttendanceEntryDto,
  TeamKioskPunchDto,
  UpdateTeamMemberAccessCodeDto,
  UpdateTeamPresenceDto,
} from '../dto';
import { TeamAttendanceService } from '../services/team-attendance.service';

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

@Controller('agency/team')
export class TeamAttendanceController {
  constructor(private readonly teamAttendanceService: TeamAttendanceService) {}

  @Get('members/:id/presence')
  getPresence(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamAttendanceService.getPresence(getContextFromHeaders(headers), id);
  }

  @Patch('members/:id/presence')
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
  kioskPunch(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: TeamKioskPunchDto,
  ) {
    return this.teamAttendanceService.kioskPunch(getContextFromHeaders(headers), dto);
  }
}
