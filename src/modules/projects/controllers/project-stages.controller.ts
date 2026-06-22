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
  UseGuards,
} from '@nestjs/common';
import { ProjectStagesService } from '../services/project-stages.service';
import {
  CreatePersonalTaskStageDto,
  CreateProjectStageDto,
  CreateTaskStageDto,
  UpdatePersonalTaskStageDto,
  UpdateProjectStageDto,
  UpdateTaskStageDto,
} from '../dto';
import {
  DangerousAction,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
} from '../../permissions';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

function getContextFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): RequestContext {
  const tenantId = String(headers['x-tenant-id'] ?? '');
  const workspaceId = String(headers['x-workspace-id'] ?? '');
  const userId = String(headers['x-user-id'] ?? '');

  return {
    tenantId,
    workspaceId,
    userId,
  };
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/projects')
export class ProjectStagesController {
  constructor(private readonly projectStagesService: ProjectStagesService) {}

  @Get('project-stages')
  @RequirePermission('agency.projects.stages.manage.admin')
  listProjectStages(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.projectStagesService.listProjectStages(
      getContextFromHeaders(headers),
    );
  }

  @Post('project-stages')
  @RequirePermission('agency.projects.stages.manage.admin')
  createProjectStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateProjectStageDto,
  ) {
    return this.projectStagesService.createProjectStage(
      getContextFromHeaders(headers),
      dto,
    );
  }

  @Patch('project-stages/:id')
  @RequirePermission('agency.projects.stages.manage.admin')
  updateProjectStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateProjectStageDto,
  ) {
    return this.projectStagesService.updateProjectStage(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Delete('project-stages/:id')
  @RequirePermission('agency.projects.stages.manage.admin')
  @DangerousAction()
  archiveProjectStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.projectStagesService.archiveProjectStage(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Get('task-stages')
  @RequireAnyPermission(
    'agency.projects.stages.manage.admin',
    'agency.tasks.task.update.assigned',
  )
  listTaskStages(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query('projectId') projectId?: string,
  ) {
    return this.projectStagesService.listTaskStages(
      getContextFromHeaders(headers),
      projectId === 'null' ? null : projectId,
    );
  }

  @Post('task-stages')
  @RequirePermission('agency.projects.stages.manage.admin')
  createTaskStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTaskStageDto,
  ) {
    return this.projectStagesService.createTaskStage(
      getContextFromHeaders(headers),
      dto,
    );
  }

  @Patch('task-stages/:id')
  @RequirePermission('agency.projects.stages.manage.admin')
  updateTaskStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTaskStageDto,
  ) {
    return this.projectStagesService.updateTaskStage(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Delete('task-stages/:id')
  @RequirePermission('agency.projects.stages.manage.admin')
  @DangerousAction()
  archiveTaskStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.projectStagesService.archiveTaskStage(
      getContextFromHeaders(headers),
      id,
    );
  }

  @Get('my-task-stages')
  @RequirePermission('agency.tasks.task.update.assigned')
  listPersonalTaskStages(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.projectStagesService.listPersonalTaskStages(
      getContextFromHeaders(headers),
    );
  }

  @Post('my-task-stages')
  @RequirePermission('agency.tasks.task.update.assigned')
  createPersonalTaskStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreatePersonalTaskStageDto,
  ) {
    return this.projectStagesService.createPersonalTaskStage(
      getContextFromHeaders(headers),
      dto,
    );
  }

  @Patch('my-task-stages/:id')
  @RequirePermission('agency.tasks.task.update.assigned')
  updatePersonalTaskStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdatePersonalTaskStageDto,
  ) {
    return this.projectStagesService.updatePersonalTaskStage(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Delete('my-task-stages/:id')
  @RequirePermission('agency.tasks.task.update.assigned')
  @DangerousAction()
  deletePersonalTaskStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.projectStagesService.deletePersonalTaskStage(
      getContextFromHeaders(headers),
      id,
    );
  }
}
