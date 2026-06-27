import { Controller, Get, Headers, Param, Query, UseGuards } from '@nestjs/common';
import { ProjectBoardsService } from '../services/project-boards.service';
import {
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
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: String(headers['x-user-id'] ?? ''),
  };
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/projects')
export class ProjectBoardsController {
  constructor(private readonly projectBoardsService: ProjectBoardsService) {}

  @Get('board')
  @RequirePermission('agency.projects.project.view.assigned')
  getProjectsBoard(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.projectBoardsService.getProjectsBoard(
      getContextFromHeaders(headers),
      includeArchived === 'true',
    );
  }

  @Get('reports/checklist-items')
  @RequirePermission('agency.tasks.task.manage.department')
  listAllChecklistItems(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.projectBoardsService.listAllChecklistItems(
      getContextFromHeaders(headers),
    );
  }

  @Get('tasks/board')
  @RequirePermission('agency.tasks.task.manage.department')
  getWorkspaceTasksBoard(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.projectBoardsService.getWorkspaceTasksBoard(
      getContextFromHeaders(headers),
      includeArchived === 'true',
    );
  }

  @Get(':projectId/tasks/board')
  @RequireAnyPermission(
    'agency.projects.project.view.assigned',
    'agency.tasks.task.manage.department',
  )
  getProjectTasksBoard(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('projectId') projectId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.projectBoardsService.getProjectTasksBoard(
      getContextFromHeaders(headers),
      projectId,
      includeArchived === 'true',
    );
  }

  @Get('tasks/my/board')
  @RequirePermission('agency.tasks.task.update.assigned')
  getMyTasksBoard(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.projectBoardsService.getMyTasksBoard(
      getContextFromHeaders(headers),
      includeArchived === 'true',
    );
  }
}
