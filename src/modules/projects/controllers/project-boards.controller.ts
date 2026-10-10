import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ProjectBoardsService } from '../services/project-boards.service';
import {
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
export class ProjectBoardsController {
  constructor(private readonly projectBoardsService: ProjectBoardsService) {}

  @Get('board')
  @RequirePermission('agency.projects.project.view.assigned')
  getProjectsBoard(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.projectBoardsService.getProjectsBoard(
      context,
      includeArchived === 'true',
    );
  }

  @Get('reports/checklist-items')
  @RequirePermission('agency.tasks.task.manage.department')
  listAllChecklistItems(
    @AuthorizedContext() context: AuthorizedRequestContext,
  ) {
    return this.projectBoardsService.listAllChecklistItems(context);
  }

  @Get('tasks/board')
  @RequirePermission('agency.tasks.task.manage.department')
  getWorkspaceTasksBoard(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.projectBoardsService.getWorkspaceTasksBoard(
      context,
      includeArchived === 'true',
    );
  }

  @Get(':projectId/tasks/board')
  @RequireAnyPermission(
    'agency.projects.project.view.assigned',
    'agency.tasks.task.manage.department',
  )
  getProjectTasksBoard(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('projectId') projectId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.projectBoardsService.getProjectTasksBoard(
      context,
      projectId,
      includeArchived === 'true',
    );
  }

  @Get('tasks/my/board')
  @RequirePermission('agency.tasks.task.update.assigned')
  getMyTasksBoard(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.projectBoardsService.getMyTasksBoard(
      context,
      includeArchived === 'true',
    );
  }
}
