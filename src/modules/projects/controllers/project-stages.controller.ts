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
import { ProjectStagesService } from '../services/project-stages.service';
import {
  CreatePersonalTaskStageDto,
  CreateProjectStageDto,
  CreateTaskStageDto,
  UpdatePersonalTaskStageDto,
  UpdateProjectStageDto,
  UpdateTaskStageDto,
} from '../dto';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

function getContextFromHeaders(headers: Record<string, string | string[] | undefined>): RequestContext {
  const tenantId = String(headers['x-tenant-id'] ?? '');
  const workspaceId = String(headers['x-workspace-id'] ?? '');
  const userId = String(headers['x-user-id'] ?? '');

  return {
    tenantId,
    workspaceId,
    userId,
  };
}

@Controller('agency/projects')
export class ProjectStagesController {
  constructor(private readonly projectStagesService: ProjectStagesService) {}

  @Get('project-stages')
  listProjectStages(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.projectStagesService.listProjectStages(getContextFromHeaders(headers));
  }

  @Post('project-stages')
  createProjectStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateProjectStageDto,
  ) {
    return this.projectStagesService.createProjectStage(getContextFromHeaders(headers), dto);
  }

  @Patch('project-stages/:id')
  updateProjectStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateProjectStageDto,
  ) {
    return this.projectStagesService.updateProjectStage(getContextFromHeaders(headers), id, dto);
  }

  @Delete('project-stages/:id')
  archiveProjectStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.projectStagesService.archiveProjectStage(getContextFromHeaders(headers), id);
  }

  @Get('task-stages')
  listTaskStages(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.projectStagesService.listTaskStages(getContextFromHeaders(headers));
  }

  @Post('task-stages')
  createTaskStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateTaskStageDto,
  ) {
    return this.projectStagesService.createTaskStage(getContextFromHeaders(headers), dto);
  }

  @Patch('task-stages/:id')
  updateTaskStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateTaskStageDto,
  ) {
    return this.projectStagesService.updateTaskStage(getContextFromHeaders(headers), id, dto);
  }

  @Delete('task-stages/:id')
  archiveTaskStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.projectStagesService.archiveTaskStage(getContextFromHeaders(headers), id);
  }

  @Get('my-task-stages')
  listPersonalTaskStages(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.projectStagesService.listPersonalTaskStages(getContextFromHeaders(headers));
  }

  @Post('my-task-stages')
  createPersonalTaskStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreatePersonalTaskStageDto,
  ) {
    return this.projectStagesService.createPersonalTaskStage(getContextFromHeaders(headers), dto);
  }

  @Patch('my-task-stages/:id')
  updatePersonalTaskStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdatePersonalTaskStageDto,
  ) {
    return this.projectStagesService.updatePersonalTaskStage(getContextFromHeaders(headers), id, dto);
  }

  @Delete('my-task-stages/:id')
  deletePersonalTaskStage(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.projectStagesService.deletePersonalTaskStage(getContextFromHeaders(headers), id);
  }
}
