import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  AgencyProject,
  AgencyTask,
  AgencyProjectEvent,
  AgencyTaskAttachment,
  AgencyTaskChecklistItem,
  AgencyTaskComment,
  AgencyTaskTimeEntry,
} from '../entities';
import { TaskStatus, TaskVisibility } from '../enums';
import {
  CreateTaskDto,
  ListTasksQueryDto,
  UpdateTaskDto,
} from '../dto';
import { FilesService } from '../../../common/files/files.service';
import { TaskNotificationPublisher } from './task-notification.publisher';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  role?: string;
};

function normalizeRole(role?: string): string {
  if (role === 'owner') return 'owner';
  if (role === 'admin' || role === 'administrator') return 'admin';
  if (role === 'manager') return 'manager';
  return 'member';
}

function isElevatedRole(role?: string): boolean {
  return ['owner', 'admin'].includes(normalizeRole(role));
}

@Injectable()
export class TasksCrudService {
  constructor(
    @InjectRepository(AgencyTask, 'agency')
    private readonly tasksRepository: Repository<AgencyTask>,

    @InjectRepository(AgencyProjectEvent, 'agency')
    private readonly eventsRepository: Repository<AgencyProjectEvent>,

    @InjectRepository(AgencyProject, 'agency')
    private readonly projectsRepository: Repository<AgencyProject>,

    @InjectRepository(AgencyTaskAttachment, 'agency')
    private readonly attachmentsRepository: Repository<AgencyTaskAttachment>,

    @InjectRepository(AgencyTaskChecklistItem, 'agency')
    private readonly checklistItemsRepository: Repository<AgencyTaskChecklistItem>,

    @InjectRepository(AgencyTaskComment, 'agency')
    private readonly commentsRepository: Repository<AgencyTaskComment>,

    @InjectRepository(AgencyTaskTimeEntry, 'agency')
    private readonly timeEntriesRepository: Repository<AgencyTaskTimeEntry>,

    private readonly filesService: FilesService,
    private readonly taskNotificationPublisher: TaskNotificationPublisher,
  ) {}

  private recordProjectEvent(context: RequestContext, projectId: string, body: string) {
    const event = this.eventsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      projectId,
      authorId: context.userId,
      kind: 'system',
      body,
      dueAt: null,
      meta: null,
    });
    return this.eventsRepository.save(event);
  }

  listWorkspaceTasks(context: RequestContext, query: ListTasksQueryDto) {
    const qb = this.tasksRepository
      .createQueryBuilder('task')
      .where('task.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('task.workspace_id = :workspaceId', { workspaceId: context.workspaceId })
      .andWhere('task.archived_at IS NULL')
      .andWhere('task.visibility = :visibility', { visibility: TaskVisibility.Workspace });

    this.applyCollectionScope(qb, context);
    this.applyFilters(qb, query);

    return qb
      .orderBy('task.updated_at', 'DESC')
      .addOrderBy('task.created_at', 'DESC')
      .getMany();
  }

  listMyTasks(context: RequestContext, query: ListTasksQueryDto) {
    const qb = this.tasksRepository
      .createQueryBuilder('task')
      .where('task.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('task.workspace_id = :workspaceId', { workspaceId: context.workspaceId })
      .andWhere('task.archived_at IS NULL')
      .andWhere(
        new Brackets((subQb) => {
          subQb
            .where('task.assignee_id = :userId', { userId: context.userId })
            .orWhere('task.created_by_id = :userId', {
              userId: context.userId,
            })
            .orWhere(
              `EXISTS (
                SELECT 1
                FROM agency_projects project_scope
                WHERE project_scope.tenant_id = task.tenant_id
                  AND project_scope.workspace_id = task.workspace_id
                  AND project_scope.id = task.project_id
                  AND project_scope.archived_at IS NULL
                  AND project_scope.owner_id = :userId
              )`,
              { userId: context.userId },
            )
            .orWhere(
              `EXISTS (
                SELECT 1
                FROM agency_project_followers follower_scope
                WHERE follower_scope.tenant_id = task.tenant_id
                  AND follower_scope.workspace_id = task.workspace_id
                  AND follower_scope.project_id = task.project_id
                  AND follower_scope.user_id = :userId
              )`,
              { userId: context.userId },
            );
        }),
      );

    this.applyFilters(qb, query);

    return qb
      .orderBy('task.updated_at', 'DESC')
      .addOrderBy('task.created_at', 'DESC')
      .getMany();
  }

  async findOne(context: RequestContext, id: string) {
    const task = await this.tasksRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!task || task.archivedAt) {
      throw new NotFoundException('Task not found');
    }

    if (task.visibility === TaskVisibility.Private && task.createdById !== context.userId) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }

  async createWorkspaceTask(context: RequestContext, dto: CreateTaskDto) {
    const task = this.tasksRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      projectId: dto.projectId ?? null,
      clientId: dto.clientId ?? null,
      stageId: dto.stageId ?? null,
      personalStageId: null,
      assigneeId: dto.assigneeId ?? null,
      createdById: context.userId,
      title: dto.title,
      description: dto.description ?? null,
      status: dto.status ?? TaskStatus.InProgress,
      priority: dto.priority,
      taskTypeId: dto.taskTypeId ?? null,
      visibility: TaskVisibility.Workspace,
      startDate: dto.startDate ? new Date(dto.startDate) : null,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      completedAt: dto.status === TaskStatus.Done ? new Date() : null,
      estimatedMinutes: dto.estimatedMinutes ?? null,
      trackedMinutes: 0,
      isBlocked: dto.isBlocked ?? false,
      blockedReason: dto.blockedReason ?? null,
      markerIds: dto.markerIds ?? [],
      archivedAt: null,
    });

    const saved = await this.tasksRepository.save(task);
    if (dto.projectId) {
      void this.recordProjectEvent(context, dto.projectId, `Tarefa criada: "${dto.title}"`);
    }

    if (saved.assigneeId) {
      await this.taskNotificationPublisher.publishAssigned({
        task: saved,
        actorUserId: context.userId,
      });
    }

    return saved;
  }

  createMyTask(context: RequestContext, dto: CreateTaskDto) {
    const task = this.tasksRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      projectId: dto.projectId ?? null,
      clientId: dto.clientId ?? null,
      stageId: null,
      personalStageId: dto.personalStageId ?? null,
      assigneeId: context.userId,
      createdById: context.userId,
      title: dto.title,
      description: dto.description ?? null,
      status: dto.status ?? TaskStatus.InProgress,
      priority: dto.priority,
      taskTypeId: dto.taskTypeId ?? null,
      visibility: TaskVisibility.Private,
      startDate: dto.startDate ? new Date(dto.startDate) : null,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      completedAt: dto.status === TaskStatus.Done ? new Date() : null,
      estimatedMinutes: dto.estimatedMinutes ?? null,
      trackedMinutes: 0,
      isBlocked: dto.isBlocked ?? false,
      blockedReason: dto.blockedReason ?? null,
      markerIds: dto.markerIds ?? [],
      archivedAt: null,
    });

    return this.tasksRepository.save(task);
  }

  async update(context: RequestContext, id: string, dto: UpdateTaskDto) {
    const task = await this.findOne(context, id);
    const previousAssigneeId = task.assigneeId;
    const previousStatus = task.status;
    const previousBlocked = this.isTaskBlocked(task);

    if (dto.title !== undefined) task.title = dto.title;
    if (dto.description !== undefined) task.description = dto.description;
    if (dto.projectId !== undefined) task.projectId = dto.projectId;
    if (dto.clientId !== undefined) task.clientId = dto.clientId;
    if (dto.stageId !== undefined) task.stageId = dto.stageId;
    if (dto.personalStageId !== undefined) task.personalStageId = dto.personalStageId;
    if (dto.assigneeId !== undefined) task.assigneeId = dto.assigneeId;
    if (dto.priority !== undefined) task.priority = dto.priority;
    if (dto.taskTypeId !== undefined) task.taskTypeId = dto.taskTypeId;
    if (dto.visibility !== undefined) task.visibility = dto.visibility;
    if (dto.estimatedMinutes !== undefined) task.estimatedMinutes = dto.estimatedMinutes;
    if (dto.trackedMinutes !== undefined) task.trackedMinutes = dto.trackedMinutes;
    if (dto.isBlocked !== undefined) task.isBlocked = dto.isBlocked;
    if (dto.blockedReason !== undefined) task.blockedReason = dto.blockedReason;
    if (dto.color !== undefined) task.color = dto.color;
    if (dto.coverImageUrl !== undefined) task.coverImageUrl = dto.coverImageUrl;
    if (dto.markerIds !== undefined) task.markerIds = dto.markerIds;

    if (dto.startDate !== undefined) {
      task.startDate = dto.startDate ? new Date(dto.startDate) : null;
    }

    if (dto.dueDate !== undefined) {
      task.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }

    if (dto.status !== undefined) {
      task.status = dto.status;

      if (dto.status === TaskStatus.Done && !task.completedAt) {
        task.completedAt = new Date();
      }

      if (dto.status !== TaskStatus.Done) {
        task.completedAt = null;
      }
    }

    const saved = await this.tasksRepository.save(task);

    if (task.projectId && dto.status !== undefined && dto.status !== previousStatus) {
      void this.recordProjectEvent(
        context,
        task.projectId,
        `Tarefa "${task.title}": status alterado para "${dto.status}"`,
      );
    }

    await this.publishUpdateNotifications(context, saved, {
      previousAssigneeId,
      previousBlocked,
      previousStatus,
    });

    return saved;
  }

  async uploadCover(context: RequestContext, id: string, file: Express.Multer.File) {
    const task = await this.findOne(context, id);
    const stored = await this.filesService.uploadImageAsset({
      file,
      path: `tenants/${context.tenantId}/workspaces/${context.workspaceId}/tasks/${id}/cover-${Date.now()}.webp`,
      maxDimension: 1200,
    });

    task.coverImageUrl = stored.url;
    task.coverImageAssetKey = stored.path;

    return this.tasksRepository.save(task);
  }

  async archive(context: RequestContext, id: string) {
    const task = await this.findOne(context, id);

    task.status = TaskStatus.Archived;
    task.archivedAt = new Date();

    const saved = await this.tasksRepository.save(task);

    if (task.projectId) {
      void this.recordProjectEvent(context, task.projectId, `Tarefa arquivada: "${task.title}"`);
    }

    return saved;
  }

  async remove(context: RequestContext, id: string) {
    const task = await this.tasksRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    await this.checklistItemsRepository.delete({ taskId: id });
    await this.commentsRepository.delete({ taskId: id });
    await this.timeEntriesRepository.delete({ taskId: id });
    await this.attachmentsRepository.delete({ taskId: id });

    await this.tasksRepository.delete(task.id);

    if (task.projectId) {
      void this.recordProjectEvent(context, task.projectId, `Tarefa excluída permanentemente: "${task.title}"`);
    }

    return { deleted: true };
  }

  private applyFilters(qb: ReturnType<Repository<AgencyTask>['createQueryBuilder']>, query: ListTasksQueryDto) {
    if (query.search) {
      qb.andWhere('task.title ILIKE :search', { search: `%${query.search}%` });
    }

    if (query.projectId) {
      qb.andWhere('task.project_id = :projectId', { projectId: query.projectId });
    }

    if (query.clientId) {
      qb.andWhere('task.client_id = :clientId', { clientId: query.clientId });
    }

    if (query.stageId) {
      qb.andWhere('task.stage_id = :stageId', { stageId: query.stageId });
    }

    if (query.personalStageId) {
      qb.andWhere('task.personal_stage_id = :personalStageId', {
        personalStageId: query.personalStageId,
      });
    }

    if (query.assigneeId) {
      qb.andWhere('task.assignee_id = :assigneeId', { assigneeId: query.assigneeId });
    }

    if (query.status) {
      qb.andWhere('task.status = :status', { status: query.status });
    }

    if (query.priority) {
      qb.andWhere('task.priority = :priority', { priority: query.priority });
    }

    if (query.visibility) {
      qb.andWhere('task.visibility = :visibility', { visibility: query.visibility });
    }
  }

  private applyCollectionScope(
    qb: ReturnType<Repository<AgencyTask>['createQueryBuilder']>,
    context: RequestContext,
  ) {
    if (isElevatedRole(context.role)) {
      return;
    }

    if (!context.userId) {
      qb.andWhere('1 = 0');
      return;
    }

    // TODO(permissions-sprint-9): expand manager department scope once tasks
    // or projects expose explicit department ownership metadata.
    qb.andWhere(
      new Brackets((scopeQb) => {
        scopeQb
          .where('task.assignee_id = :scopeUserId', {
            scopeUserId: context.userId,
          })
          .orWhere('task.created_by_id = :scopeUserId', {
            scopeUserId: context.userId,
          })
          .orWhere(
            `EXISTS (
              SELECT 1
              FROM agency_projects project_scope
              WHERE project_scope.tenant_id = task.tenant_id
                AND project_scope.workspace_id = task.workspace_id
                AND project_scope.id = task.project_id
                AND project_scope.archived_at IS NULL
                AND project_scope.owner_id = :scopeUserId
            )`,
          )
          .orWhere(
            `EXISTS (
              SELECT 1
              FROM agency_project_followers follower_scope
              WHERE follower_scope.tenant_id = task.tenant_id
                AND follower_scope.workspace_id = task.workspace_id
                AND follower_scope.project_id = task.project_id
                AND follower_scope.user_id = :scopeUserId
            )`,
          );
      }),
    );
  }

  private async publishUpdateNotifications(
    context: RequestContext,
    task: AgencyTask,
    previous: {
      previousAssigneeId: string | null;
      previousBlocked: boolean;
      previousStatus: TaskStatus;
    },
  ) {
    if (previous.previousAssigneeId !== task.assigneeId && task.assigneeId) {
      if (previous.previousAssigneeId) {
        await this.taskNotificationPublisher.publishReassigned({
          task,
          actorUserId: context.userId,
          previousAssigneeId: previous.previousAssigneeId,
        });
      } else {
        await this.taskNotificationPublisher.publishAssigned({
          task,
          actorUserId: context.userId,
        });
      }
    }

    if (
      previous.previousStatus !== TaskStatus.Done &&
      task.status === TaskStatus.Done
    ) {
      await this.taskNotificationPublisher.publishCompleted({
        task,
        actorUserId: context.userId,
      });
    }

    if (
      previous.previousStatus === TaskStatus.Done &&
      task.status !== TaskStatus.Done &&
      task.status !== TaskStatus.Archived &&
      task.status !== TaskStatus.Cancelled
    ) {
      await this.taskNotificationPublisher.publishReopened({
        task,
        actorUserId: context.userId,
      });
    }

    const currentBlocked = this.isTaskBlocked(task);

    if (previous.previousBlocked !== currentBlocked) {
      const projectOwnerId = await this.findProjectOwnerId(task);

      if (currentBlocked) {
        await this.taskNotificationPublisher.publishBlocked({
          task,
          actorUserId: context.userId,
          projectOwnerId,
        });
      } else {
        await this.taskNotificationPublisher.publishUnblocked({
          task,
          actorUserId: context.userId,
          projectOwnerId,
        });
      }
    }
  }

  private isTaskBlocked(task: AgencyTask) {
    return task.isBlocked || task.status === TaskStatus.Blocked;
  }

  private async findProjectOwnerId(task: AgencyTask) {
    if (!task.projectId) {
      return null;
    }

    const project = await this.projectsRepository.findOne({
      where: {
        id: task.projectId,
        tenantId: task.tenantId,
        workspaceId: task.workspaceId,
      },
      select: ['id', 'ownerId'],
    });

    return project?.ownerId ?? null;
  }
}
