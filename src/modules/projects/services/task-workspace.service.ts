import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  AgencyProject,
  AgencyTask,
  AgencyTaskChecklistItem,
  AgencyTaskComment,
  AgencyTaskTimeEntry,
} from '../entities';
import { TaskStatus } from '../enums';
import { TasksCrudService } from './tasks-crud.service';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  role?: string;
};

type ChecklistPayload = {
  title?: string;
  description?: string | null;
  isDone?: boolean;
  status?: string;
  position?: number;
  taskTypeId?: string | null;
  assigneeId?: string | null;
  personalStageId?: string | null;
  dueDate?: string | null;
};

// Marca uma time entry criada por edição manual do tempo (diferencia das
// marcações reais do cronômetro).
const MANUAL_TIME_NOTE = 'Ajuste manual';

// Marca a entry de tarefa aberta automaticamente quando um timer de subtarefa
// inicia. Só entries com esta nota são pausadas junto com a subtarefa — um
// timer iniciado manualmente pelo usuário nunca é pausado automaticamente.
const AUTO_TASK_TIMER_NOTE = 'Timer automático (subtarefa)';

const TIME_ADMIN_ROLES = new Set(['owner', 'admin']);

function formatMinutesLabel(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}min`;
  return `${h}h ${String(m).padStart(2, '0')}min`;
}

function getChecklistStatusFromDone(isDone: boolean) {
  return isDone ? 'done' : 'in_progress';
}

function isChecklistStatusDone(status: string) {
  return status === 'done';
}

function isTaskStatusCompleted(status: string) {
  return status === TaskStatus.Done || status === TaskStatus.Approved;
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
  // Subtask entries drive labor cost; task-level entries stay separate and are
  // used for elapsed task cycle time.
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
    const wasDone = item.isDone;

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
    if (payload.personalStageId !== undefined) item.personalStageId = payload.personalStageId;
    if (payload.dueDate !== undefined) {
      item.dueDate = payload.dueDate ? new Date(payload.dueDate) : null;
    }

    const saved = await this.checklistRepository.save(item);
    if (!wasDone && saved.isDone) {
      await this.stopActiveChecklistTimers(context, taskId, itemId);
    }
    const [augmented] = await this.augmentChecklistWithTime(context, [saved]);
    return augmented;
  }

  async deleteChecklistItem(context: RequestContext, taskId: string, itemId: string) {
    const item = await this.updateChecklistItem(context, taskId, itemId, {});

    await this.checklistRepository.delete(item.id);

    return { deleted: true };
  }

  // ── Per-subtask time tracking ────────────────────────────────────────────
  // Each subtask keeps its own timer per user, and subtasks may run
  // concurrently. These entries are tagged with checklistItemId and do not roll
  // into the parent task elapsed timer.
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
    const [task, item] = await Promise.all([
      this.tasksCrudService.findOne(context, taskId),
      this.getChecklistItem(context, taskId, itemId),
    ]);
    this.assertTaskAllowsTimer(task);
    this.assertChecklistAllowsTimer(item);

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
      await this.ensureAutoTaskTimer(context, taskId);
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

    const saved = await this.timeEntriesRepository.save(entry);
    await this.ensureAutoTaskTimer(context, taskId);
    return saved;
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

    await this.stopEntry(entry);
    await this.releaseAutoTaskTimer(context, taskId, context.userId);

    return entry;
  }

  // Garante um timer de tarefa rodando para o usuário enquanto uma subtarefa
  // cronometra. Se já existe entry ativa (manual ou automática), reaproveita.
  private async ensureAutoTaskTimer(context: RequestContext, taskId: string) {
    const activeEntry = await this.timeEntriesRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
        checklistItemId: IsNull(),
        userId: context.userId,
        stoppedAt: IsNull(),
      },
    });

    if (activeEntry) return activeEntry;

    return this.timeEntriesRepository.save(
      this.timeEntriesRepository.create({
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
        checklistItemId: null,
        userId: context.userId,
        startedAt: new Date(),
        stoppedAt: null,
        durationMinutes: null,
        note: AUTO_TASK_TIMER_NOTE,
      }),
    );
  }

  // Pausa o timer de tarefa iniciado automaticamente por uma subtarefa, mas só
  // quando o usuário não tem mais nenhum timer de subtarefa rodando na tarefa.
  private async releaseAutoTaskTimer(
    context: RequestContext,
    taskId: string,
    userId: string,
  ) {
    const stillRunning = await this.timeEntriesRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
        checklistItemId: Not(IsNull()),
        userId,
        stoppedAt: IsNull(),
      },
    });

    if (stillRunning) return;

    const autoEntry = await this.timeEntriesRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
        checklistItemId: IsNull(),
        userId,
        stoppedAt: IsNull(),
        note: AUTO_TASK_TIMER_NOTE,
      },
    });

    if (autoEntry) {
      await this.stopEntry(autoEntry, { rollUpToTask: true });
    }
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
          personalStageId: item.personalStageId ?? null,
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
    const task = await this.tasksCrudService.findOne(context, taskId);
    this.assertTaskAllowsTimer(task);
    const activeEntry = await this.timeEntriesRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
        checklistItemId: IsNull(),
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
      checklistItemId: null,
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
        checklistItemId: IsNull(),
        userId: context.userId,
      },
    });

    if (!entry) {
      throw new NotFoundException('Time entry not found');
    }

    await this.stopEntry(entry, { rollUpToTask: true });

    return entry;
  }

  async stopActiveTimer(context: RequestContext, taskId: string) {
    await this.tasksCrudService.findOne(context, taskId);
    const entry = await this.timeEntriesRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
        checklistItemId: IsNull(),
        userId: context.userId,
        stoppedAt: IsNull(),
      },
    });
    if (!entry) return { stopped: false };
    await this.stopEntry(entry, { rollUpToTask: true });
    return entry;
  }

  // Define manualmente o tempo total registrado de uma tarefa. O valor é
  // materializado como uma entry de ajuste ("Ajuste manual") para manter a
  // soma das time entries consistente com o total exibido, e também grava o
  // valor no campo agregado da tarefa (usado por board e dashboards).
  async setTaskTrackedMinutes(
    context: RequestContext,
    taskId: string,
    minutes: number,
  ) {
    const task = await this.tasksCrudService.findOne(context, taskId);
    const result = await this.applyManualTime(context, taskId, null, minutes);

    task.trackedMinutes = result.trackedMinutes;
    await this.tasksRepository.save(task);

    return result;
  }

  // Define manualmente o tempo registrado de uma subtarefa (checklist item).
  // Subtarefas não têm campo agregado próprio — o tempo é sempre derivado das
  // time entries, então basta materializar a entry de ajuste.
  async setChecklistTrackedMinutes(
    context: RequestContext,
    taskId: string,
    itemId: string,
    minutes: number,
  ) {
    const item = await this.getChecklistItem(context, taskId, itemId);

    if (
      (item.isDone || isChecklistStatusDone(item.status)) &&
      !TIME_ADMIN_ROLES.has(context.role ?? '')
    ) {
      throw new ForbiddenException(
        'Somente owner ou admin podem editar o tempo de uma subtarefa concluída.',
      );
    }

    return this.applyManualTime(context, taskId, itemId, minutes);
  }

  private async applyManualTime(
    context: RequestContext,
    taskId: string,
    itemId: string | null,
    minutes: number,
  ): Promise<{ trackedMinutes: number }> {
    const target = this.normalizeMinutes(minutes);

    const allEntries = await this.timeEntriesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
      },
    });

    const entries = allEntries.filter((entry) =>
      itemId ? entry.checklistItemId === itemId : !entry.checklistItemId,
    );

    // O tempo da tarefa nunca pode ficar abaixo do total já registrado nas
    // subtarefas — esse total é a fonte do custo de mão de obra.
    if (!itemId) {
      const subtaskMinutes = allEntries
        .filter((entry) => entry.checklistItemId && entry.stoppedAt)
        .reduce((sum, entry) => sum + (entry.durationMinutes ?? 0), 0);

      if (target < subtaskMinutes) {
        throw new BadRequestException(
          `O tempo da tarefa não pode ser menor que o total registrado nas subtarefas (${formatMinutesLabel(subtaskMinutes)}).`,
        );
      }
    }

    const manualEntries = entries.filter(
      (entry) => entry.note === MANUAL_TIME_NOTE,
    );
    const timerEntries = entries.filter(
      (entry) => entry.note !== MANUAL_TIME_NOTE && entry.stoppedAt,
    );
    const timerMinutes = timerEntries.reduce(
      (sum, entry) => sum + (entry.durationMinutes ?? 0),
      0,
    );

    if (manualEntries.length > 0) {
      await this.timeEntriesRepository.remove(manualEntries);
    }

    if (target >= timerMinutes) {
      const manualDelta = target - timerMinutes;

      if (manualDelta > 0) {
        const now = new Date();
        await this.timeEntriesRepository.save(
          this.timeEntriesRepository.create({
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            taskId,
            checklistItemId: itemId,
            userId: context.userId,
            startedAt: now,
            stoppedAt: now,
            durationMinutes: manualDelta,
            note: MANUAL_TIME_NOTE,
          }),
        );
      }

      return { trackedMinutes: target };
    }

    // Redução abaixo do tempo cronometrado: apara as marcações mais recentes
    // até a soma bater com o alvo (cobre o caso de timer esquecido rodando).
    let excess = timerMinutes - target;
    const trimmed: typeof timerEntries = [];
    const ordered = [...timerEntries].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );

    for (const entry of ordered) {
      if (excess <= 0) break;
      const duration = entry.durationMinutes ?? 0;
      if (duration <= 0) continue;

      const cut = Math.min(duration, excess);
      entry.durationMinutes = duration - cut;
      entry.stoppedAt = new Date(
        new Date(entry.startedAt).getTime() + entry.durationMinutes * 60_000,
      );
      excess -= cut;
      trimmed.push(entry);
    }

    if (trimmed.length > 0) {
      await this.timeEntriesRepository.save(trimmed);
    }

    return { trackedMinutes: target };
  }

  private normalizeMinutes(value: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadRequestException('Tempo informado é inválido.');
    }

    const rounded = Math.round(value);

    if (rounded < 0) {
      throw new BadRequestException('O tempo não pode ser negativo.');
    }

    // Limite de sanidade: 1 ano em minutos.
    return Math.min(rounded, 525_600);
  }

  async listActiveTimers(context: RequestContext) {
    const entries = await this.timeEntriesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        stoppedAt: IsNull(),
      },
      select: ['taskId', 'checklistItemId', 'startedAt'],
    });
    return entries.map((e) => ({
      taskId: e.taskId,
      checklistItemId: e.checklistItemId,
      startedAt: e.startedAt.toISOString(),
    }));
  }

  private assertTaskAllowsTimer(task: AgencyTask) {
    if (isTaskStatusCompleted(task.status)) {
      throw new BadRequestException('Cannot track time on completed tasks');
    }
  }

  private assertChecklistAllowsTimer(item: AgencyTaskChecklistItem) {
    if (item.isDone || isChecklistStatusDone(item.status)) {
      throw new BadRequestException('Cannot track time on completed subtasks');
    }
  }

  private async stopActiveChecklistTimers(
    context: RequestContext,
    taskId: string,
    itemId: string,
  ) {
    const entries = await this.timeEntriesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        taskId,
        checklistItemId: itemId,
        stoppedAt: IsNull(),
      },
    });

    for (const entry of entries) {
      await this.stopEntry(entry);
    }

    // Concluir a subtarefa também libera o timer automático da tarefa de cada
    // usuário que estava cronometrando este item.
    const userIds = Array.from(new Set(entries.map((entry) => entry.userId)));
    for (const userId of userIds) {
      await this.releaseAutoTaskTimer(context, taskId, userId);
    }
  }

  private async stopEntry(
    entry: AgencyTaskTimeEntry,
    options: { rollUpToTask?: boolean } = {},
  ) {
    if (entry.stoppedAt) return entry;

    entry.stoppedAt = new Date();
    const elapsedSeconds = Math.floor(
      (entry.stoppedAt.getTime() - entry.startedAt.getTime()) / 1000,
    );
    entry.durationMinutes = Math.max(0, Math.round(elapsedSeconds / 60));
    await this.timeEntriesRepository.save(entry);

    if (!options.rollUpToTask) {
      return entry;
    }

    const task = await this.tasksRepository.findOne({
      where: {
        id: entry.taskId,
        tenantId: entry.tenantId,
        workspaceId: entry.workspaceId,
      },
    });

    if (task) {
      task.trackedMinutes = (task.trackedMinutes ?? 0) + (entry.durationMinutes ?? 0);
      await this.tasksRepository.save(task);
    }

    return entry;
  }
}
