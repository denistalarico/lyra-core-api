import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  AgencyProject,
  AgencyTask,
  AgencyTaskChecklistItem,
  AgencyTaskComment,
  AgencyTaskTimeEntry,
} from '../entities';
import { TasksCrudService } from './tasks-crud.service';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

type ChecklistPayload = {
  title?: string;
  description?: string | null;
  isDone?: boolean;
  status?: string;
  position?: number;
  taskTypeId?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
};

function getChecklistStatusFromDone(isDone: boolean) {
  return isDone ? 'done' : 'in_progress';
}

function isChecklistStatusDone(status: string) {
  return status === 'done' || status === 'approved';
}

@Injectable()
export class TaskWorkspaceService {
  constructor(
    @InjectRepository(AgencyTask, 'agency')
    private readonly tasksRepository: Repository<AgencyTask>,

    @InjectRepository(AgencyTaskChecklistItem, 'agency')
    private readonly checklistRepository: Repository<AgencyTaskChecklistItem>,

    @InjectRepository(AgencyTaskComment, 'agency')
    private readonly commentsRepository: Repository<AgencyTaskComment>,

    @InjectRepository(AgencyTaskTimeEntry, 'agency')
    private readonly timeEntriesRepository: Repository<AgencyTaskTimeEntry>,

    @InjectRepository(AgencyProject, 'agency')
    private readonly projectsRepository: Repository<AgencyProject>,

    private readonly tasksCrudService: TasksCrudService,
  ) {}

  async listChecklist(context: RequestContext, taskId: string) {
    await this.tasksCrudService.findOne(context, taskId);

    const items = await this.checklistRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
      },
      order: {
        position: 'ASC',
        createdAt: 'ASC',
      },
    });

    return this.augmentChecklistWithTime(context, items);
  }

  // Adds per-subtask `trackedMinutes` (sum of stopped entries) and
  // `activeTimerStartedAt` (the current user's running entry for that item).
  // Timers are independent per subtask, so several can run at once.
  private async augmentChecklistWithTime(
    context: RequestContext,
    items: AgencyTaskChecklistItem[],
  ) {
    const itemIds = items.map((item) => item.id);
    if (itemIds.length === 0) return items.map((item) => ({ ...item, trackedMinutes: 0, activeTimerStartedAt: null }));

    const entries = await this.timeEntriesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        checklistItemId: In(itemIds),
      },
    });

    const trackedByItem = new Map<string, number>();
    const activeByItem = new Map<string, Date>();
    for (const entry of entries) {
      if (!entry.checklistItemId) continue;
      if (entry.stoppedAt) {
        trackedByItem.set(
          entry.checklistItemId,
          (trackedByItem.get(entry.checklistItemId) ?? 0) + (entry.durationMinutes ?? 0),
        );
      } else if (entry.userId === context.userId) {
        activeByItem.set(entry.checklistItemId, entry.startedAt);
      }
    }

    return items.map((item) => ({
      ...item,
      trackedMinutes: trackedByItem.get(item.id) ?? 0,
      activeTimerStartedAt: activeByItem.get(item.id) ?? null,
    }));
  }

  async getChecklistItem(context: RequestContext, taskId: string, itemId: string) {
    await this.tasksCrudService.findOne(context, taskId);
    const item = await this.checklistRepository.findOne({
      where: {
        id: itemId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
      },
    });

    if (!item) {
      throw new NotFoundException('Checklist item not found');
    }

    const [augmented] = await this.augmentChecklistWithTime(context, [item]);
    return augmented;
  }

  async createChecklistItem(
    context: RequestContext,
    taskId: string,
    payload: ChecklistPayload,
  ) {
    await this.tasksCrudService.findOne(context, taskId);
    const currentCount = await this.checklistRepository.count({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
      },
    });

    const item = this.checklistRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      taskId,
      title: payload.title?.trim() || 'Nova subtarefa',
      description: payload.description ?? null,
      isDone: payload.isDone ?? false,
      status: payload.status ?? getChecklistStatusFromDone(payload.isDone ?? false),
      position: payload.position ?? currentCount,
      taskTypeId: payload.taskTypeId ?? null,
      assigneeId: payload.assigneeId ?? null,
      dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
    });

    return this.checklistRepository.save(item);
  }

  async updateChecklistItem(
    context: RequestContext,
    taskId: string,
    itemId: string,
    payload: ChecklistPayload,
  ) {
    await this.tasksCrudService.findOne(context, taskId);
    const item = await this.checklistRepository.findOne({
      where: {
        id: itemId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
      },
    });

    if (!item) {
      throw new NotFoundException('Checklist item not found');
    }

    if (payload.title !== undefined) item.title = payload.title;
    if (payload.description !== undefined) item.description = payload.description;
    if (payload.status !== undefined) {
      item.status = payload.status;
      item.isDone = isChecklistStatusDone(payload.status);
    } else if (payload.isDone !== undefined) {
      item.isDone = payload.isDone;
      item.status = getChecklistStatusFromDone(payload.isDone);
    }
    if (payload.position !== undefined) item.position = payload.position;
    if (payload.taskTypeId !== undefined) item.taskTypeId = payload.taskTypeId;
    if (payload.assigneeId !== undefined) item.assigneeId = payload.assigneeId;
    if (payload.dueDate !== undefined) {
      item.dueDate = payload.dueDate ? new Date(payload.dueDate) : null;
    }

    const saved = await this.checklistRepository.save(item);
    const [augmented] = await this.augmentChecklistWithTime(context, [saved]);
    return augmented;
  }

  async deleteChecklistItem(context: RequestContext, taskId: string, itemId: string) {
    const item = await this.updateChecklistItem(context, taskId, itemId, {});

    await this.checklistRepository.delete(item.id);

    return { deleted: true };
  }

  // ── Per-subtask time tracking ────────────────────────────────────────────
  // Each subtask keeps its own timer per user. Starting a subtask timer does
  // NOT stop other subtasks' timers, so labour on several subtasks (possibly
  // by the same person) can be tracked simultaneously and separately.
  async listChecklistTimeEntries(
    context: RequestContext,
    taskId: string,
    itemId: string,
  ) {
    await this.getChecklistItem(context, taskId, itemId);
    return this.timeEntriesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
        checklistItemId: itemId,
      },
      order: { startedAt: 'DESC' },
    });
  }

  async startChecklistTimer(
    context: RequestContext,
    taskId: string,
    itemId: string,
  ) {
    await this.getChecklistItem(context, taskId, itemId);

    const activeEntry = await this.timeEntriesRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
        checklistItemId: itemId,
        userId: context.userId,
        stoppedAt: IsNull(),
      },
    });

    if (activeEntry) {
      return activeEntry;
    }

    const entry = this.timeEntriesRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      taskId,
      checklistItemId: itemId,
      userId: context.userId,
      startedAt: new Date(),
      stoppedAt: null,
      durationMinutes: null,
      note: null,
    });

    return this.timeEntriesRepository.save(entry);
  }

  async stopChecklistTimer(
    context: RequestContext,
    taskId: string,
    itemId: string,
  ) {
    await this.getChecklistItem(context, taskId, itemId);

    const entry = await this.timeEntriesRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
        checklistItemId: itemId,
        userId: context.userId,
        stoppedAt: IsNull(),
      },
    });

    if (!entry) return { stopped: false };

    entry.stoppedAt = new Date();
    const elapsedSeconds = Math.floor(
      (entry.stoppedAt.getTime() - entry.startedAt.getTime()) / 1000,
    );
    entry.durationMinutes = Math.round(elapsedSeconds / 60);
    await this.timeEntriesRepository.save(entry);

    // Roll subtask time up into the parent task so client labour cost /
    // profitability keep counting it.
    const task = await this.tasksRepository.findOne({
      where: { id: taskId, tenantId: context.tenantId, workspaceId: context.workspaceId },
    });
    if (task) {
      task.trackedMinutes = (task.trackedMinutes ?? 0) + entry.durationMinutes;
      await this.tasksRepository.save(task);
    }

    return entry;
  }

  // Subtasks (checklist items) assigned to the current user, shaped as
  // task-like cards so they can show up on /projects/my-tasks alongside tasks.
  async getMyAssignedSubtaskCards(context: RequestContext) {
    // Subtask assignees are stored as team-member ids (same convention as task
    // assignees), so resolve the current user's member id(s) and match either
    // that or the raw user id to be safe.
    const memberRows: Array<{ id: string }> = await this.checklistRepository.manager.query(
      `SELECT id FROM team_members WHERE tenant_id = $1 AND user_id = $2`,
      [context.tenantId, context.userId],
    );
    const assigneeIds = Array.from(
      new Set([context.userId, ...memberRows.map((row) => row.id)]),
    );

    const items = await this.checklistRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        assigneeId: In(assigneeIds),
      },
      order: { updatedAt: 'DESC' },
    });

    if (items.length === 0) return [];

    const taskIds = Array.from(new Set(items.map((item) => item.taskId)));
    const tasks = await this.tasksRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        id: In(taskIds),
        archivedAt: IsNull(),
      },
    });
    const taskById = new Map(tasks.map((task) => [task.id, task]));

    const projectIds = Array.from(
      new Set(tasks.map((task) => task.projectId).filter((id): id is string => Boolean(id))),
    );
    const projects = projectIds.length
      ? await this.projectsRepository.find({
          where: {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            id: In(projectIds),
          },
        })
      : [];
    const projectById = new Map(projects.map((project) => [project.id, project]));

    const augmented = await this.augmentChecklistWithTime(context, items);

    return augmented
      .filter((item) => taskById.has(item.taskId)) // drop subtasks of archived/missing tasks
      .map((item) => {
        const task = taskById.get(item.taskId)!;
        const project = task.projectId ? projectById.get(task.projectId) ?? null : null;
        return {
          id: item.id,
          isSubtask: true as const,
          parentTaskId: item.taskId,
          parentTaskTitle: task.title,
          title: item.title,
          status: item.status,
          dueDate: item.dueDate,
          assigneeId: item.assigneeId,
          projectId: task.projectId ?? null,
          projectName: project?.name ?? null,
          clientId: project?.clientId ?? null,
          taskTypeId: item.taskTypeId,
          trackedMinutes: item.trackedMinutes,
          activeTimerStartedAt: item.activeTimerStartedAt,
          checklistTotal: 0,
          checklistDone: 0,
          progress: item.isDone ? 100 : 0,
        };
      });
  }

  async listComments(context: RequestContext, taskId: string) {
    await this.tasksCrudService.findOne(context, taskId);

    return this.commentsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async createComment(context: RequestContext, taskId: string, body: string) {
    await this.tasksCrudService.findOne(context, taskId);
    const comment = this.commentsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      taskId,
      authorId: context.userId,
      body: body.trim(),
    });

    return this.commentsRepository.save(comment);
  }

  async deleteComment(context: RequestContext, taskId: string, commentId: string) {
    await this.tasksCrudService.findOne(context, taskId);
    await this.commentsRepository.delete({ id: commentId, tenantId: context.tenantId, workspaceId: context.workspaceId, taskId });
    return { deleted: true };
  }

  async listTimeEntries(context: RequestContext, taskId: string) {
    await this.tasksCrudService.findOne(context, taskId);

    return this.timeEntriesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
      },
      order: {
        startedAt: 'DESC',
      },
    });
  }

  async startTimer(context: RequestContext, taskId: string) {
    await this.tasksCrudService.findOne(context, taskId);
    const activeEntry = await this.timeEntriesRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
        userId: context.userId,
        stoppedAt: IsNull(),
      },
    });

    if (activeEntry) {
      return activeEntry;
    }

    const entry = this.timeEntriesRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      taskId,
      userId: context.userId,
      startedAt: new Date(),
      stoppedAt: null,
      durationMinutes: null,
      note: null,
    });

    return this.timeEntriesRepository.save(entry);
  }

  async stopTimer(context: RequestContext, taskId: string, entryId: string) {
    await this.tasksCrudService.findOne(context, taskId);
    const entry = await this.timeEntriesRepository.findOne({
      where: {
        id: entryId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
        userId: context.userId,
      },
    });

    if (!entry) {
      throw new NotFoundException('Time entry not found');
    }

    if (!entry.stoppedAt) {
      entry.stoppedAt = new Date();
      // Store exact seconds-based duration (in minutes field, using fractional minutes for precision)
      const elapsedSeconds = Math.floor((entry.stoppedAt.getTime() - entry.startedAt.getTime()) / 1000);
      entry.durationMinutes = Math.round(elapsedSeconds / 60); // round to nearest minute for totals
      await this.timeEntriesRepository.save(entry);

      const task = await this.tasksRepository.findOne({
        where: {
          id: taskId,
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
        },
      });

      if (task) {
        task.trackedMinutes = (task.trackedMinutes ?? 0) + entry.durationMinutes;
        await this.tasksRepository.save(task);
      }
    }

    return entry;
  }

  async stopActiveTimer(context: RequestContext, taskId: string) {
    await this.tasksCrudService.findOne(context, taskId);
    const entry = await this.timeEntriesRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
        stoppedAt: IsNull(),
      },
    });
    if (!entry) return { stopped: false };
    entry.stoppedAt = new Date();
    const elapsedSeconds = Math.floor((entry.stoppedAt.getTime() - entry.startedAt.getTime()) / 1000);
    entry.durationMinutes = Math.round(elapsedSeconds / 60);
    await this.timeEntriesRepository.save(entry);
    const task = await this.tasksRepository.findOne({ where: { id: taskId, tenantId: context.tenantId, workspaceId: context.workspaceId } });
    if (task) { task.trackedMinutes = (task.trackedMinutes ?? 0) + entry.durationMinutes; await this.tasksRepository.save(task); }
    return entry;
  }

  async listActiveTimers(context: RequestContext) {
    const entries = await this.timeEntriesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        stoppedAt: IsNull(),
      },
      select: ['taskId', 'startedAt'],
    });
    return entries.map((e) => ({ taskId: e.taskId, startedAt: e.startedAt.toISOString() }));
  }
}
