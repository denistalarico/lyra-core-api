import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TeamService } from '../services/team.service';
import {
  CreateTeamDepartmentDto,
  CreateTeamMemberDto,
  CreateTeamSkillDto,
  ListTeamMembersQueryDto,
  UpdateTeamDepartmentDto,
  UpdateTeamMemberDto,
  UpdateTeamSkillDto,
  UpsertTeamMemberSkillDto,
} from '../dto';

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
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get('health')
  health() {
    return this.teamService.health();
  }

  @Post('seed-defaults')
  seedDefaults(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.teamService.seedDefaults(getContextFromHeaders(headers));
  }

  @Get('departments')
  listDepartments(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.teamService.listDepartments(getContextFromHeaders(headers));
  }

  @Post('departments')
  createDepartment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTeamDepartmentDto,
  ) {
    return this.teamService.createDepartment(getContextFromHeaders(headers), dto);
  }

  @Patch('departments/:id')
  updateDepartment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDepartmentDto,
  ) {
    return this.teamService.updateDepartment(getContextFromHeaders(headers), id, dto);
  }

  @Delete('departments/:id')
  archiveDepartment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamService.archiveDepartment(getContextFromHeaders(headers), id);
  }

  @Get('skills')
  listSkills(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.teamService.listSkills(getContextFromHeaders(headers));
  }

  @Post('skills')
  createSkill(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTeamSkillDto,
  ) {
    return this.teamService.createSkill(getContextFromHeaders(headers), dto);
  }

  @Patch('skills/:id')
  updateSkill(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTeamSkillDto,
  ) {
    return this.teamService.updateSkill(getContextFromHeaders(headers), id, dto);
  }

  @Delete('skills/:id')
  archiveSkill(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamService.archiveSkill(getContextFromHeaders(headers), id);
  }

  @Get('members')
  listMembers(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListTeamMembersQueryDto,
  ) {
    return this.teamService.listMembers(getContextFromHeaders(headers), query);
  }

  @Get('members/:id')
  getMember(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamService.getMember(getContextFromHeaders(headers), id);
  }

  @Post('members')
  createMember(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTeamMemberDto,
  ) {
    return this.teamService.createMember(getContextFromHeaders(headers), dto);
  }

  @Patch('members/:id')
  updateMember(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.teamService.updateMember(getContextFromHeaders(headers), id, dto);
  }

  @Delete('members/:id')
  archiveMember(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamService.archiveMember(getContextFromHeaders(headers), id);
  }

  @Post('members/:id/skills')
  upsertMemberSkill(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpsertTeamMemberSkillDto,
  ) {
    return this.teamService.upsertMemberSkill(getContextFromHeaders(headers), id, dto);
  }

  @Delete('members/:id/skills/:skillId')
  removeMemberSkill(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('skillId') skillId: string,
  ) {
    return this.teamService.removeMemberSkill(getContextFromHeaders(headers), id, skillId);
  }
}
