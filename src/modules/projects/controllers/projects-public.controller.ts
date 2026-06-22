import { Controller, Get, Headers, NotFoundException, Param, Query } from '@nestjs/common';
import { ProjectsCrudService } from '../services/projects-crud.service';
import { TasksCrudService } from '../services/tasks-crud.service';
import { ProjectStagesService } from '../services/project-stages.service';
import { ProjectEventsService } from '../services/project-events.service';
import { ProjectFollowersAttachmentsService } from '../services/project-followers-attachments.service';
import { TaskAttachmentsService } from '../services/task-attachments.service';
import { TaskWorkspaceService } from '../services/task-workspace.service';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  role?: string;
};

function getContextFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): RequestContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: '',
    // Public reads are already gated by isPublicPageEnabled + password below;
    // 'owner' bypasses the per-user ownership/assignment scoping that would
    // otherwise hide most of the board from an anonymous visitor.
    role: 'owner',
  };
}

/**
 * Unauthenticated read-only endpoints backing the public project/task share
 * pages. Intentionally has no @UseGuards: access is gated by the project's
 * own isPublicPageEnabled flag and optional publicPagePassword instead of a
 * session.
 */
@Controller('agency/projects-public')
export class ProjectsPublicController {
  constructor(
    private readonly projectsCrudService: ProjectsCrudService,
    private readonly tasksCrudService: TasksCrudService,
    private readonly projectStagesService: ProjectStagesService,
    private readonly projectEventsService: ProjectEventsService,
    private readonly projectFollowersAttachmentsService: ProjectFollowersAttachmentsService,
    private readonly taskAttachmentsService: TaskAttachmentsService,
    private readonly taskWorkspaceService: TaskWorkspaceService,
  ) {}

  @Get(':projectId')
  async getPublicProject(
    @Param('projectId') projectId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query('password') password?: string,
  ) {
    const context = getContextFromHeaders(headers);
    const project = await this.projectsCrudService
      .findOne(context, projectId)
      .catch(() => null);

    if (!project || !project.isPublicPageEnabled) {
      throw new NotFoundException('Public project page not available');
    }

    if (project.publicPagePassword && project.publicPagePassword !== password) {
      return { locked: true, project: { id: project.id, name: project.name } };
    }

    const [tasks, stages, events, attachments] = await Promise.all([
      this.tasksCrudService.listWorkspaceTasks(context, { projectId }),
      this.projectStagesService.listTaskStages(context, projectId),
      this.projectEventsService.list(context, projectId).catch(() => []),
      this.projectFollowersAttachmentsService
        .listAttachments(context, projectId)
        .catch(() => []),
    ]);

    return { locked: false, project, tasks, stages, events, attachments };
  }

  @Get(':projectId/tasks/:taskId')
  async getPublicTask(
    @Param('projectId') projectId: string,
    @Param('taskId') taskId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query('password') password?: string,
  ) {
    const context = getContextFromHeaders(headers);
    const project = await this.projectsCrudService
      .findOne(context, projectId)
      .catch(() => null);

    if (!project || !project.isPublicPageEnabled) {
      throw new NotFoundException('Public project page not available');
    }

    if (project.publicPagePassword && project.publicPagePassword !== password) {
      return { locked: true, project: { id: project.id, name: project.name } };
    }

    const task = await this.tasksCrudService.findOne(context, taskId);

    if (task.projectId !== projectId) {
      throw new NotFoundException('Task not found');
    }

    const [checklist, attachments] = await Promise.all([
      this.taskWorkspaceService.listChecklist(context, taskId),
      this.taskAttachmentsService.listAttachments(context, taskId),
    ]);

    return { locked: false, task, project, checklist, attachments };
  }
}
