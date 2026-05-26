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
  position?: number;
};

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
      position: payload.position ?? currentCount,
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
    if (payload.isDone !== undefined) item.isDone = payload.isDone;
    if (payload.position !== undefined) item.position = payload.position;

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
      entry.durationMinutes = Math.max(
        1,
        Math.round((entry.stoppedAt.getTime() - entry.startedAt.getTime()) / 60000),
      );
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
}
