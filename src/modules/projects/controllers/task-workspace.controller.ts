import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TaskWorkspaceService } from '../services/task-workspace.service';
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
@Controller('agency/projects/tasks/:taskId')
export class TaskWorkspaceController {
  constructor(private readonly taskWorkspaceService: TaskWorkspaceService) {}

  @Get('checklist')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  listChecklist(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
  ) {
    return this.taskWorkspaceService.listChecklist(context, taskId);
  }

  @Post('checklist')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  createChecklistItem(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
    @Body()
    body: {
      title?: string;
      description?: string | null;
      isDone?: boolean;
      status?: string;
      position?: number;
      taskTypeId?: string | null;
      assigneeId?: string | null;
      personalStageId?: string | null;
      dueDate?: string | null;
    },
  ) {
    return this.taskWorkspaceService.createChecklistItem(context, taskId, body);
  }

  @Patch('checklist/:itemId')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  updateChecklistItem(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
    @Param('itemId') itemId: string,
    @Body()
    body: {
      title?: string;
      description?: string | null;
      isDone?: boolean;
      status?: string;
      position?: number;
      taskTypeId?: string | null;
      assigneeId?: string | null;
      personalStageId?: string | null;
      dueDate?: string | null;
    },
  ) {
    return this.taskWorkspaceService.updateChecklistItem(
      context,
      taskId,
      itemId,
      body,
    );
  }

  @Delete('checklist/:itemId')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  @DangerousAction()
  deleteChecklistItem(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.taskWorkspaceService.deleteChecklistItem(
      context,
      taskId,
      itemId,
    );
  }

  @Get('checklist/:itemId')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  getChecklistItem(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.taskWorkspaceService.getChecklistItem(context, taskId, itemId);
  }

  @Get('checklist/:itemId/time')
  @RequirePermission('agency.tasks.time.track.self')
  listChecklistTimeEntries(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.taskWorkspaceService.listChecklistTimeEntries(
      context,
      taskId,
      itemId,
    );
  }

  @Patch('checklist/:itemId/time/manual')
  @RequirePermission('agency.tasks.time.track.self')
  setChecklistTrackedMinutes(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
    @Param('itemId') itemId: string,
    @Body() body: { minutes?: number },
  ) {
    return this.taskWorkspaceService.setChecklistTrackedMinutes(
      context,
      taskId,
      itemId,
      Number(body?.minutes ?? 0),
    );
  }

  @Post('checklist/:itemId/time/start')
  @RequirePermission('agency.tasks.time.track.self')
  startChecklistTimer(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.taskWorkspaceService.startChecklistTimer(
      context,
      taskId,
      itemId,
    );
  }

  @Patch('checklist/:itemId/time/stop')
  @RequirePermission('agency.tasks.time.track.self')
  stopChecklistTimer(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.taskWorkspaceService.stopChecklistTimer(
      context,
      taskId,
      itemId,
    );
  }

  @Get('comments')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  listComments(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
  ) {
    return this.taskWorkspaceService.listComments(context, taskId);
  }

  @Delete('comments/:commentId')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  @DangerousAction()
  deleteComment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
    @Param('commentId') commentId: string,
  ) {
    return this.taskWorkspaceService.deleteComment(context, taskId, commentId);
  }

  @Post('comments')
  @RequireAnyPermission(
    'agency.tasks.task.update.assigned',
    'agency.tasks.task.manage.department',
  )
  createComment(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
    @Body() body: { body?: string },
  ) {
    return this.taskWorkspaceService.createComment(
      context,
      taskId,
      body.body ?? '',
    );
  }

  @Get('time-entries')
  @RequirePermission('agency.tasks.time.track.self')
  listTimeEntries(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
  ) {
    return this.taskWorkspaceService.listTimeEntries(context, taskId);
  }

  @Patch('time-entries/manual')
  @RequirePermission('agency.tasks.time.track.self')
  setTaskTrackedMinutes(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
    @Body() body: { minutes?: number },
  ) {
    return this.taskWorkspaceService.setTaskTrackedMinutes(
      context,
      taskId,
      Number(body?.minutes ?? 0),
    );
  }

  @Post('time-entries/start')
  @RequirePermission('agency.tasks.time.track.self')
  startTimer(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
  ) {
    return this.taskWorkspaceService.startTimer(context, taskId);
  }

  @Patch('time-entries/stop-active')
  @RequirePermission('agency.tasks.time.track.self')
  stopActiveTimer(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
  ) {
    return this.taskWorkspaceService.stopActiveTimer(context, taskId);
  }

  @Patch('time-entries/:entryId/stop')
  @RequirePermission('agency.tasks.time.track.self')
  stopTimer(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('taskId') taskId: string,
    @Param('entryId') entryId: string,
  ) {
    return this.taskWorkspaceService.stopTimer(context, taskId, entryId);
  }
}
