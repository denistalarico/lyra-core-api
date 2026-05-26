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
import { TaskWorkspaceService } from '../services/task-workspace.service';

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

@Controller('agency/projects/tasks/:taskId')
export class TaskWorkspaceController {
  constructor(private readonly taskWorkspaceService: TaskWorkspaceService) {}

  @Get('checklist')
  listChecklist(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('taskId') taskId: string,
  ) {
    return this.taskWorkspaceService.listChecklist(getContextFromHeaders(headers), taskId);
  }

  @Post('checklist')
  createChecklistItem(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('taskId') taskId: string,
    @Body() body: { title?: string; isDone?: boolean; position?: number },
  ) {
    return this.taskWorkspaceService.createChecklistItem(
      getContextFromHeaders(headers),
      taskId,
      body,
    );
  }

  @Patch('checklist/:itemId')
  updateChecklistItem(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('taskId') taskId: string,
    @Param('itemId') itemId: string,
    @Body() body: { title?: string; isDone?: boolean; position?: number },
  ) {
    return this.taskWorkspaceService.updateChecklistItem(
      getContextFromHeaders(headers),
      taskId,
      itemId,
      body,
    );
  }

  @Delete('checklist/:itemId')
  deleteChecklistItem(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('taskId') taskId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.taskWorkspaceService.deleteChecklistItem(
      getContextFromHeaders(headers),
      taskId,
      itemId,
    );
  }

  @Get('comments')
  listComments(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('taskId') taskId: string,
  ) {
    return this.taskWorkspaceService.listComments(getContextFromHeaders(headers), taskId);
  }

  @Post('comments')
  createComment(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('taskId') taskId: string,
    @Body() body: { body?: string },
  ) {
    return this.taskWorkspaceService.createComment(
      getContextFromHeaders(headers),
      taskId,
      body.body ?? '',
    );
  }

  @Get('time-entries')
  listTimeEntries(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('taskId') taskId: string,
  ) {
    return this.taskWorkspaceService.listTimeEntries(getContextFromHeaders(headers), taskId);
  }

  @Post('time-entries/start')
  startTimer(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('taskId') taskId: string,
  ) {
    return this.taskWorkspaceService.startTimer(getContextFromHeaders(headers), taskId);
  }

  @Patch('time-entries/:entryId/stop')
  stopTimer(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('taskId') taskId: string,
    @Param('entryId') entryId: string,
  ) {
    return this.taskWorkspaceService.stopTimer(
      getContextFromHeaders(headers),
      taskId,
      entryId,
    );
  }
}
