import { Controller, Get, Headers, Param } from '@nestjs/common';
import { ProjectBoardsService } from '../services/project-boards.service';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

function getContextFromHeaders(headers: Record<string, string | string[] | undefined>): RequestContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: String(headers['x-user-id'] ?? ''),
  };
}

@Controller('agency/projects')
export class ProjectBoardsController {
  constructor(private readonly projectBoardsService: ProjectBoardsService) {}

  @Get('board')
  getProjectsBoard(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.projectBoardsService.getProjectsBoard(getContextFromHeaders(headers));
  }

  @Get('tasks/board')
  getWorkspaceTasksBoard(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.projectBoardsService.getWorkspaceTasksBoard(getContextFromHeaders(headers));
  }

  @Get(':projectId/tasks/board')
  getProjectTasksBoard(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('projectId') projectId: string,
  ) {
    return this.projectBoardsService.getProjectTasksBoard(getContextFromHeaders(headers), projectId);
  }

  @Get('tasks/my/board')
  getMyTasksBoard(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.projectBoardsService.getMyTasksBoard(getContextFromHeaders(headers));
  }
}
