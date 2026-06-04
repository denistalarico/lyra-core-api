import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { AgencyTask, AgencyProjectEvent } from '../entities';
import { TaskStatus, TaskVisibility } from '../enums';
import {
  CreateTaskDto,
  ListTasksQueryDto,
  UpdateTaskDto,
} from '../dto';
import { FilesService } from '../../../common/files/files.service';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

@Injectable()
export class TasksCrudService {
  constructor(
    @InjectRepository(AgencyTask, 'agency')
    private readonly tasksRepository: Repository<AgencyTask>,

    @InjectRepository(AgencyProjectEvent, 'agency')
    private readonly eventsRepository: Repository<AgencyProjectEvent>,

    private readonly filesService: FilesService,
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
            .orWhere('task.created_by_id = :userId AND task.visibility = :privateVisibility', {
              userId: context.userId,
              privateVisibility: TaskVisibility.Private,
            });
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

    const prevStatus = task.status;

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

    if (task.projectId && dto.status !== undefined && dto.status !== prevStatus) {
      void this.recordProjectEvent(
        context,
        task.projectId,
        `Tarefa "${task.title}": status alterado para "${dto.status}"`,
      );
    }

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
}
