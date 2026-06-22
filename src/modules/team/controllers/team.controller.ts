import {
  applyDecorators,
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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
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
  GenerateTeamAttendanceReportPdfDto,
} from '../dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  DangerousAction,
  PermissionsGuard,
  RequirePermission,
} from '../../permissions';

const RequireTeamPermission = (permissionKey: string) =>
  applyDecorators(
    UseGuards(JwtAuthGuard, PermissionsGuard),
    RequirePermission(permissionKey),
  );

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

  // TODO(permissions): enforce department/self member scopes when scoped
  // evaluators are available for team member routes.
  @Post('seed-defaults')
  @RequireTeamPermission('agency.team.structure.manage.admin')
  seedDefaults(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.teamService.seedDefaults(getContextFromHeaders(headers));
  }

  @Get('departments')
  @RequireTeamPermission('agency.team.directory.view.all_members')
  listDepartments(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.teamService.listDepartments(getContextFromHeaders(headers));
  }

  @Post('departments')
  @RequireTeamPermission('agency.team.structure.manage.admin')
  createDepartment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTeamDepartmentDto,
  ) {
    return this.teamService.createDepartment(getContextFromHeaders(headers), dto);
  }

  @Patch('departments/:id')
  @RequireTeamPermission('agency.team.structure.manage.admin')
  updateDepartment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDepartmentDto,
  ) {
    return this.teamService.updateDepartment(getContextFromHeaders(headers), id, dto);
  }

  @Delete('departments/:id/permanent')
  @DangerousAction()
  @RequireTeamPermission('agency.team.structure.delete.owner_only')
  deleteDepartment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamService.deleteDepartment(getContextFromHeaders(headers), id);
  }

  @Delete('departments/:id')
  @DangerousAction()
  @RequireTeamPermission('agency.team.structure.manage.admin')
  archiveDepartment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamService.archiveDepartment(getContextFromHeaders(headers), id);
  }

  @Get('skills')
  @RequireTeamPermission('agency.team.directory.view.all_members')
  listSkills(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.teamService.listSkills(getContextFromHeaders(headers));
  }

  @Post('skills')
  @RequireTeamPermission('agency.team.structure.manage.admin')
  createSkill(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTeamSkillDto,
  ) {
    return this.teamService.createSkill(getContextFromHeaders(headers), dto);
  }

  @Patch('skills/:id')
  @RequireTeamPermission('agency.team.structure.manage.admin')
  updateSkill(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTeamSkillDto,
  ) {
    return this.teamService.updateSkill(getContextFromHeaders(headers), id, dto);
  }

  @Delete('skills/:id')
  @DangerousAction()
  @RequireTeamPermission('agency.team.structure.manage.admin')
  archiveSkill(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamService.archiveSkill(getContextFromHeaders(headers), id);
  }

  @Get('config-options')
  @RequireTeamPermission('agency.team.directory.view.all_members')
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
      | 'skill_level'
      | 'onboarding_template'
      | 'offboarding_template'
      | 'payment_benefit_template'
      | 'payment_discount_template'
      | 'payment_document_template'
      | 'payment_finance_setting'
      | 'client_loss_reason'
      | 'client_onboarding_template'
      | 'client_offboarding_template'
      | 'lifecycle_step_type'
      | 'client_lifecycle_step_type'
      | 'client_onboarding_task'
      | 'client_offboarding_task',
  ) {
    return this.teamService.listConfigOptions(getContextFromHeaders(headers), type);
  }

  @Post('config-options')
  @RequireTeamPermission('agency.team.structure.manage.admin')
  createConfigOption(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTeamConfigOptionDto,
  ) {
    return this.teamService.createConfigOption(getContextFromHeaders(headers), dto);
  }

  @Patch('config-options/:id')
  @RequireTeamPermission('agency.team.structure.manage.admin')
  updateConfigOption(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTeamConfigOptionDto,
  ) {
    return this.teamService.updateConfigOption(getContextFromHeaders(headers), id, dto);
  }

  @Delete('config-options/:id')
  @DangerousAction()
  @RequireTeamPermission('agency.team.structure.delete.owner_only')
  deleteConfigOption(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamService.deleteConfigOption(getContextFromHeaders(headers), id);
  }

  @Get('config-options/:id/document-pdf')
  @RequireTeamPermission('agency.team.directory.view.all_members')
  async getConfigOptionDocumentPdf(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.teamService.renderDocumentTemplatePdf(
      getContextFromHeaders(headers),
      id,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="modelo-${id}.pdf"`);
    res.send(buffer);
  }

  @Get('config-options/:id/document-preview-html')
  @RequireTeamPermission('agency.team.directory.view.all_members')
  async getConfigOptionDocumentPreviewHtml(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    const html = await this.teamService.renderDocumentTemplateHtml(
      getContextFromHeaders(headers),
      id,
    );
    return { html };
  }

  @Post('attendance-report/pdf')
  @RequireTeamPermission('agency.team.directory.view.all_members')
  async generateAttendanceReportPdf(
    @Body() dto: GenerateTeamAttendanceReportPdfDto,
    @Res() res: Response,
  ) {
    const buffer = await this.teamService.renderAttendanceReportPdf(dto.html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="relatorio-presenca-${new Date().toISOString().slice(0, 10)}.pdf"`,
    );
    res.send(buffer);
  }

  @Get('members')
  @RequireTeamPermission('agency.team.member.view.department')
  listMembers(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListTeamMembersQueryDto,
  ) {
    return this.teamService.listMembers(getContextFromHeaders(headers), query);
  }

  @Get('members/:id')
  @RequireTeamPermission('agency.team.member.view.department')
  getMember(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamService.getMember(getContextFromHeaders(headers), id);
  }

  @Post('members')
  @RequireTeamPermission('agency.team.users.invite.admin')
  createMember(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTeamMemberDto,
  ) {
    return this.teamService.createMember(getContextFromHeaders(headers), dto);
  }

  @Patch('members/:id')
  @RequireTeamPermission('agency.team.member.update.department')
  updateMember(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.teamService.updateMember(getContextFromHeaders(headers), id, dto);
  }

  @Post('members/:id/avatar')
  @RequireTeamPermission('agency.team.member.update.department')
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
  @DangerousAction()
  @RequireTeamPermission('agency.team.users.delete.owner_only')
  deleteMember(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.teamService.deleteMember(getContextFromHeaders(headers), id);
  }

  @Post('members/:id/skills')
  @RequireTeamPermission('agency.team.member.update.department')
  upsertMemberSkill(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpsertTeamMemberSkillDto,
  ) {
    return this.teamService.upsertMemberSkill(getContextFromHeaders(headers), id, dto);
  }

  @Delete('members/:id/skills/:skillId')
  @DangerousAction()
  @RequireTeamPermission('agency.team.member.update.department')
  removeMemberSkill(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('skillId') skillId: string,
  ) {
    return this.teamService.removeMemberSkill(getContextFromHeaders(headers), id, skillId);
  }
}
