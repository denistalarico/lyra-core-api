import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { AgencyProject } from '../entities';
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

function getPublicContext(project: AgencyProject): RequestContext {
  return {
    tenantId: project.tenantId,
    workspaceId: project.workspaceId,
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
    @Query('password') password?: string,
  ) {
    const project = await this.projectsCrudService
      .findPublicOne(projectId)
      .catch(() => null);

    if (!project || !project.isPublicPageEnabled) {
      throw new NotFoundException('Public project page not available');
    }

    if (project.publicPagePassword && project.publicPagePassword !== password) {
      return { locked: true, project: { id: project.id, name: project.name } };
    }

    const context = getPublicContext(project);

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
    @Query('password') password?: string,
  ) {
    const project = await this.projectsCrudService
      .findPublicOne(projectId)
      .catch(() => null);

    if (!project || !project.isPublicPageEnabled) {
      throw new NotFoundException('Public project page not available');
    }

    if (project.publicPagePassword && project.publicPagePassword !== password) {
      return { locked: true, project: { id: project.id, name: project.name } };
    }

    const context = getPublicContext(project);
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
