import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MAX_IMAGE_UPLOAD_BYTES } from '../../../common/files/files.service';
import { TeamService } from '../services/team.service';
import {
  CreateTeamDepartmentDto,
  CreateTeamMemberDto,
  CreateTeamSkillDto,
  ListTeamMembersQueryDto,
  UpdateTeamDepartmentDto,
  UpdateTeamMemberDto,
  UpdateTeamSkillDto,
  CreateTeamConfigOptionDto,
  UpdateTeamConfigOptionDto,
  UpsertTeamMemberSkillDto,
} from '../dto';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

const IMAGE_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES,
  },
  fileFilter: (
    _request: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const allowedMimeTypes = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ]);

    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new BadRequestException('Unsupported image format.'), false);
      return;
    }

    callback(null, true);
  },
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

  @Delete('departments/:id/permanent')
  deleteDepartment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamService.deleteDepartment(getContextFromHeaders(headers), id);
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

  @Get('config-options')
  listConfigOptions(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query('type')
    type?:
      | 'job_title'
      | 'role_name'
      | 'seniority'
      | 'work_mode'
      | 'worker_type'
      | 'offboarding_reason'
      | 'contract_category'
      | 'signature_provider'
      | 'onboarding_task'
      | 'offboarding_task'
      | 'skill_category'
      | 'skill_level',
  ) {
    return this.teamService.listConfigOptions(getContextFromHeaders(headers), type);
  }

  @Post('config-options')
  createConfigOption(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTeamConfigOptionDto,
  ) {
    return this.teamService.createConfigOption(getContextFromHeaders(headers), dto);
  }

  @Patch('config-options/:id')
  updateConfigOption(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTeamConfigOptionDto,
  ) {
    return this.teamService.updateConfigOption(getContextFromHeaders(headers), id, dto);
  }

  @Delete('config-options/:id')
  deleteConfigOption(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamService.deleteConfigOption(getContextFromHeaders(headers), id);
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

  @Post('members/:id/avatar')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  uploadMemberAvatar(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Image file is required.');
    }

    return this.teamService.uploadMemberAvatar(getContextFromHeaders(headers), id, file);
  }

  @Delete('members/:id')
  deleteMember(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamService.deleteMember(getContextFromHeaders(headers), id);
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
