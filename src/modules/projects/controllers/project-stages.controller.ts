import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/projects')
export class ProjectStagesController {
  constructor(private readonly projectStagesService: ProjectStagesService) {}

  @Get('project-stages')
  @RequireAnyPermission(
    'agency.projects.stages.manage.admin',
    'agency.projects.project.update.department',
  )
  listProjectStages(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.projectStagesService.listProjectStages(context);
  }

  @Post('project-stages')
  @RequireAnyPermission(
    'agency.projects.stages.manage.admin',
    'agency.projects.project.update.department',
  )
  createProjectStage(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateProjectStageDto,
  ) {
    return this.projectStagesService.createProjectStage(context, dto);
  }

  @Patch('project-stages/:id')
  @RequireAnyPermission(
    'agency.projects.stages.manage.admin',
    'agency.projects.project.update.department',
  )
  updateProjectStage(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateProjectStageDto,
  ) {
    return this.projectStagesService.updateProjectStage(context, id, dto);
  }

  @Delete('project-stages/:id')
  @RequireAnyPermission(
    'agency.projects.stages.manage.admin',
    'agency.projects.project.archive.department',
  )
  @DangerousAction()
  archiveProjectStage(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.projectStagesService.archiveProjectStage(context, id);
  }

  @Get('task-stages')
  @RequireAnyPermission(
    'agency.projects.stages.manage.admin',
    'agency.tasks.task.update.assigned',
  )
  listTaskStages(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query('projectId') projectId?: string,
  ) {
    return this.projectStagesService.listTaskStages(
      context,
      projectId === 'null' ? null : projectId,
    );
  }

  @Post('task-stages')
  @RequireAnyPermission(
    'agency.projects.stages.manage.admin',
    'agency.tasks.task.manage.department',
  )
  createTaskStage(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateTaskStageDto,
  ) {
    return this.projectStagesService.createTaskStage(context, dto);
  }

  @Patch('task-stages/:id')
  @RequireAnyPermission(
    'agency.projects.stages.manage.admin',
    'agency.tasks.task.manage.department',
  )
  updateTaskStage(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateTaskStageDto,
  ) {
    return this.projectStagesService.updateTaskStage(context, id, dto);
  }

  @Delete('task-stages/:id')
  @RequireAnyPermission(
    'agency.projects.stages.manage.admin',
    'agency.tasks.task.manage.department',
  )
  @DangerousAction()
  archiveTaskStage(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.projectStagesService.archiveTaskStage(context, id);
  }

  @Get('my-task-stages')
  @RequirePermission('agency.tasks.task.update.assigned')
  listPersonalTaskStages(
    @AuthorizedContext() context: AuthorizedRequestContext,
  ) {
    return this.projectStagesService.listPersonalTaskStages(context);
  }

  @Post('my-task-stages')
  @RequirePermission('agency.tasks.task.update.assigned')
  createPersonalTaskStage(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreatePersonalTaskStageDto,
  ) {
    return this.projectStagesService.createPersonalTaskStage(context, dto);
  }

  @Patch('my-task-stages/:id')
  @RequirePermission('agency.tasks.task.update.assigned')
  updatePersonalTaskStage(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UpdatePersonalTaskStageDto,
  ) {
    return this.projectStagesService.updatePersonalTaskStage(context, id, dto);
  }

  @Delete('my-task-stages/:id')
  @RequirePermission('agency.tasks.task.update.assigned')
  @DangerousAction()
  deletePersonalTaskStage(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.projectStagesService.deletePersonalTaskStage(context, id);
  }
}
