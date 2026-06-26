import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
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

    private readonly tasksCrudService: TasksCrudService,
  ) {}

  async listChecklist(context: RequestContext, taskId: string) {
    await this.tasksCrudService.findOne(context, taskId);

    return this.checklistRepository.find({
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

    return this.checklistRepository.save(item);
  }

  async deleteChecklistItem(context: RequestContext, taskId: string, itemId: string) {
    const item = await this.updateChecklistItem(context, taskId, itemId, {});

    await this.checklistRepository.delete(item.id);

    return { deleted: true };
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
