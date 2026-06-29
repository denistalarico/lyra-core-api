import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { AgencyProject, AgencyTask, AgencyTaskChecklistItem } from '../entities';
import {
  ProjectPriority,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
  TaskVisibility,
} from '../enums';
import type {
  PersonalTasksDashboardSummary,
  ProjectDashboardAttentionItem,
  ProjectsDashboardOverview,
  ProjectsDashboardQuery,
  ProjectsDashboardSummary,
  SubtaskDashboardAttentionItem,
  SubtasksDashboardSummary,
  TaskDashboardAttentionItem,
  TasksDashboardLast3Months,
  TasksDashboardSummary,
} from '../types';

type DashboardRequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

type LoadedSubtasks = {
  items: AgencyTaskChecklistItem[];
  taskById: Map<string, AgencyTask>;
};

const CLOSED_TASK_STATUSES = [
  TaskStatus.Done,
  TaskStatus.Cancelled,
  TaskStatus.Archived,
];

const CLOSED_PROJECT_STATUSES = [
  ProjectStatus.Completed,
  ProjectStatus.Cancelled,
  ProjectStatus.Archived,
];

@Injectable()
export class ProjectsDashboardQueryService {
  constructor(
    @InjectRepository(AgencyProject, 'agency')
    private readonly projectsRepository: Repository<AgencyProject>,

    @InjectRepository(AgencyTask, 'agency')
    private readonly tasksRepository: Repository<AgencyTask>,

    @InjectRepository(AgencyTaskChecklistItem, 'agency')
    private readonly checklistRepository: Repository<AgencyTaskChecklistItem>,
  ) {}

  async getOverview(
    context: DashboardRequestContext,
    query: ProjectsDashboardQuery,
  ): Promise<ProjectsDashboardOverview> {
    const dueSoonDays = this.normalizePositiveInteger(query.dueSoonDays, 7);
    const priorityLimit = this.normalizePositiveInteger(query.priorityLimit, 8);

    const [projects, tasks, personalTasks] = await Promise.all([
      this.listVisibleProjects(context, query),
      this.listVisibleTasks(context, query),
      this.listPersonalTasks(context, query),
    ]);

    // Subtasks (checklist items with a due date). Workspace scope inherits the
    // visibility of its parent task; personal scope is "assigned to me", which
    // — like task assignees — is matched by team-member id.
    const [workspaceSubtasks, personalSubtasks] = await Promise.all([
      this.listVisibleSubtasks(context, tasks),
      this.listPersonalSubtasks(context, query),
    ]);

    const subtaskAssigneeNames = await this.resolveSubtaskAssigneeNames(context, [
      ...workspaceSubtasks.items,
      ...personalSubtasks.items,
    ]);

    return {
      generatedAt: new Date().toISOString(),
      scope: query.scope,
      projects: this.buildProjectsSummary(
        projects,
        dueSoonDays,
        priorityLimit,
      ),
      tasks: this.buildTasksSummary(
        tasks,
        dueSoonDays,
        priorityLimit,
      ),
      personalTasks: this.buildPersonalTasksSummary(
        personalTasks,
        dueSoonDays,
        priorityLimit,
      ),
      subtasks: this.buildSubtasksSummary(
        workspaceSubtasks,
        subtaskAssigneeNames,
        dueSoonDays,
        priorityLimit,
      ),
      personalSubtasks: this.buildSubtasksSummary(
        personalSubtasks,
        subtaskAssigneeNames,
        dueSoonDays,
        priorityLimit,
      ),
    };
  }

  private listVisibleProjects(
    context: DashboardRequestContext,
    query: ProjectsDashboardQuery,
  ) {
    const qb = this.projectsRepository
      .createQueryBuilder('project')
      .where('project.tenant_id = :tenantId', {
        tenantId: context.tenantId,
      })
      .andWhere('project.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('project.archived_at IS NULL');

    if (query.clientId) {
      qb.andWhere('project.client_id = :clientId', {
        clientId: query.clientId,
      });
    }

    if (query.ownerId) {
      qb.andWhere('project.owner_id = :ownerId', {
        ownerId: query.ownerId,
      });
    }

    if (query.scope === 'personal') {
      qb.andWhere('project.owner_id = :currentUserId', {
        currentUserId: query.userId,
      });
    }

    return qb
      .orderBy('project.due_date', 'ASC', 'NULLS LAST')
      .addOrderBy('project.updated_at', 'DESC')
      .getMany();
  }

  private listVisibleTasks(
    context: DashboardRequestContext,
    query: ProjectsDashboardQuery,
  ) {
    const qb = this.tasksRepository
      .createQueryBuilder('task')
      .where('task.tenant_id = :tenantId', {
        tenantId: context.tenantId,
      })
      .andWhere('task.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('task.archived_at IS NULL');

    this.applyTaskVisibility(qb, query.userId, query.scope);

    if (query.clientId) {
      qb.andWhere('task.client_id = :clientId', {
        clientId: query.clientId,
      });
    }

    if (query.scope === 'personal') {
      qb.andWhere(
        new Brackets((subQb) => {
          subQb
            .where('task.assignee_id = :personalUserId', {
              personalUserId: query.userId,
            })
            .orWhere(
              'task.created_by_id = :personalUserId AND task.visibility = :privateVisibility',
              {
                personalUserId: query.userId,
                privateVisibility: TaskVisibility.Private,
              },
            );
        }),
      );
    }

    return qb
      .orderBy('task.due_date', 'ASC', 'NULLS LAST')
      .addOrderBy('task.updated_at', 'DESC')
      .getMany();
  }

  private listPersonalTasks(
    context: DashboardRequestContext,
    query: ProjectsDashboardQuery,
  ) {
    const qb = this.tasksRepository
      .createQueryBuilder('task')
      .where('task.tenant_id = :tenantId', {
        tenantId: context.tenantId,
      })
      .andWhere('task.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('task.archived_at IS NULL')
      .andWhere(
        new Brackets((subQb) => {
          subQb
            .where('task.assignee_id = :userId', {
              userId: query.userId,
            })
            .orWhere(
              'task.created_by_id = :userId AND task.visibility = :privateVisibility',
              {
                userId: query.userId,
                privateVisibility: TaskVisibility.Private,
              },
            );
        }),
      );

    if (query.clientId) {
      qb.andWhere('task.client_id = :clientId', {
        clientId: query.clientId,
      });
    }

    return qb
      .orderBy('task.due_date', 'ASC', 'NULLS LAST')
      .addOrderBy('task.updated_at', 'DESC')
      .getMany();
  }

  private async listVisibleSubtasks(
    context: DashboardRequestContext,
    visibleTasks: AgencyTask[],
  ): Promise<LoadedSubtasks> {
    const taskById = new Map(visibleTasks.map((task) => [task.id, task]));

    if (taskById.size === 0) {
      return { items: [], taskById };
    }

    const items = await this.checklistRepository
      .createQueryBuilder('item')
      .where('item.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('item.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('item.task_id IN (:...taskIds)', {
        taskIds: Array.from(taskById.keys()),
      })
      .andWhere('item.due_date IS NOT NULL')
      .andWhere('item.is_done = false')
      .orderBy('item.due_date', 'ASC')
      .getMany();

    return { items, taskById };
  }

  private async listPersonalSubtasks(
    context: DashboardRequestContext,
    query: ProjectsDashboardQuery,
  ): Promise<LoadedSubtasks> {
    // Subtask assignees are stored as team-member ids (same convention as task
    // assignees), so resolve the current user's member id(s) and match either
    // that or the raw user id to be safe.
    const memberRows: Array<{ id: string }> =
      await this.checklistRepository.manager.query(
        `SELECT id FROM team_members WHERE tenant_id = $1 AND user_id = $2`,
        [context.tenantId, query.userId],
      );
    const assigneeIds = Array.from(
      new Set([query.userId, ...memberRows.map((row) => row.id)]),
    );

    const items = await this.checklistRepository
      .createQueryBuilder('item')
      .where('item.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('item.workspace_id = :workspaceId', {
        workspaceId: context.workspaceId,
      })
      .andWhere('item.assignee_id IN (:...assigneeIds)', { assigneeIds })
      .andWhere('item.due_date IS NOT NULL')
      .andWhere('item.is_done = false')
      .orderBy('item.due_date', 'ASC')
      .getMany();

    if (items.length === 0) {
      return { items: [], taskById: new Map() };
    }

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

    return {
      // drop subtasks of archived/missing parent tasks
      items: items.filter((item) => taskById.has(item.taskId)),
      taskById,
    };
  }

  private async resolveSubtaskAssigneeNames(
    context: DashboardRequestContext,
    items: AgencyTaskChecklistItem[],
  ): Promise<Map<string, string>> {
    const assigneeIds = Array.from(
      new Set(
        items
          .map((item) => item.assigneeId)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (assigneeIds.length === 0) {
      return new Map();
    }

    const rows: Array<{ id: string; display_name: string }> =
      await this.checklistRepository.manager.query(
        `SELECT id, display_name FROM team_members WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [context.tenantId, assigneeIds],
      );

    return new Map(rows.map((row) => [row.id, row.display_name]));
  }

  private applyTaskVisibility(
    qb: SelectQueryBuilder<AgencyTask>,
    userId: string,
    scope: ProjectsDashboardQuery['scope'],
  ) {
    if (scope === 'personal') {
      return;
    }

    qb.andWhere(
      new Brackets((subQb) => {
        subQb
          .where('task.visibility = :workspaceVisibility', {
            workspaceVisibility: TaskVisibility.Workspace,
          })
          .orWhere(
            'task.visibility = :privateVisibility AND task.created_by_id = :visibilityUserId',
            {
              privateVisibility: TaskVisibility.Private,
              visibilityUserId: userId,
            },
          )
          .orWhere(
            'task.visibility = :privateVisibility AND task.assignee_id = :visibilityUserId',
            {
              privateVisibility: TaskVisibility.Private,
              visibilityUserId: userId,
            },
          );
      }),
    );
  }

  private buildProjectsSummary(
    projects: AgencyProject[],
    dueSoonDays: number,
    priorityLimit: number,
  ): ProjectsDashboardSummary {
    const now = new Date();
    const dueSoonLimit = this.endOfDay(
      this.addDays(now, dueSoonDays),
    );

    const activeProjects = projects.filter(
      (project) => !CLOSED_PROJECT_STATUSES.includes(project.status),
    );

    const overdueProjects = activeProjects.filter(
      (project) =>
        project.dueDate !== null &&
        project.dueDate.getTime() < now.getTime(),
    );

    const dueSoonProjects = activeProjects.filter(
      (project) =>
        project.dueDate !== null &&
        project.dueDate.getTime() >= now.getTime() &&
        project.dueDate.getTime() <= dueSoonLimit.getTime(),
    );

    const progressTotal = activeProjects.reduce(
      (sum, project) => sum + this.clampProgress(project.progress),
      0,
    );

    const attentionItems = activeProjects
      .filter((project) => {
        const overdue =
          project.dueDate !== null &&
          project.dueDate.getTime() < now.getTime();

        const dueSoon =
          project.dueDate !== null &&
          project.dueDate.getTime() >= now.getTime() &&
          project.dueDate.getTime() <= dueSoonLimit.getTime();

        return (
          overdue ||
          dueSoon ||
          project.priority === ProjectPriority.High ||
          project.priority === ProjectPriority.Urgent ||
          project.ownerId === null
        );
      })
      .sort((a, b) =>
        this.projectAttentionScore(b, now, dueSoonLimit) -
        this.projectAttentionScore(a, now, dueSoonLimit),
      )
      .slice(0, priorityLimit)
      .map((project) =>
        this.mapProjectAttentionItem(project, now, dueSoonLimit),
      );

    return {
      total: projects.length,
      draft: this.countProjectStatus(projects, ProjectStatus.Draft),
      active: this.countProjectStatus(projects, ProjectStatus.Active),
      paused: this.countProjectStatus(projects, ProjectStatus.Paused),
      completed: this.countProjectStatus(projects, ProjectStatus.Completed),
      cancelled: this.countProjectStatus(projects, ProjectStatus.Cancelled),
      overdue: overdueProjects.length,
      dueSoon: dueSoonProjects.length,
      withoutOwner: activeProjects.filter(
        (project) => project.ownerId === null,
      ).length,
      highPriority: activeProjects.filter(
        (project) => project.priority === ProjectPriority.High,
      ).length,
      urgent: activeProjects.filter(
        (project) => project.priority === ProjectPriority.Urgent,
      ).length,
      averageProgress:
        activeProjects.length > 0
          ? Math.round(progressTotal / activeProjects.length)
          : 0,
      attentionItems,
    };
  }

  private buildTasksSummary(
    tasks: AgencyTask[],
    dueSoonDays: number,
    priorityLimit: number,
  ): TasksDashboardSummary {
    const now = new Date();
    const startToday = this.startOfDay(now);
    const endToday = this.endOfDay(now);
    const endWeek = this.endOfDay(this.addDays(now, dueSoonDays));

    const openTasks = tasks.filter(
      (task) => !CLOSED_TASK_STATUSES.includes(task.status),
    );

    const overdueTasks = openTasks.filter(
      (task) =>
        task.dueDate !== null &&
        task.dueDate.getTime() < startToday.getTime(),
    );

    const dueTodayTasks = openTasks.filter(
      (task) =>
        task.dueDate !== null &&
        task.dueDate.getTime() >= startToday.getTime() &&
        task.dueDate.getTime() <= endToday.getTime(),
    );

    const dueThisWeekTasks = openTasks.filter(
      (task) =>
        task.dueDate !== null &&
        task.dueDate.getTime() >= startToday.getTime() &&
        task.dueDate.getTime() <= endWeek.getTime(),
    );

    const attentionItems = openTasks
      .filter((task) => {
        const overdue =
          task.dueDate !== null &&
          task.dueDate.getTime() < startToday.getTime();

        const dueThisWeek =
          task.dueDate !== null &&
          task.dueDate.getTime() >= startToday.getTime() &&
          task.dueDate.getTime() <= endWeek.getTime();

        return (
          overdue ||
          dueThisWeek ||
          task.isBlocked ||
          task.assigneeId === null ||
          task.priority === TaskPriority.High ||
          task.priority === TaskPriority.Urgent
        );
      })
      .sort((a, b) =>
        this.taskAttentionScore(b, startToday, endToday, endWeek) -
        this.taskAttentionScore(a, startToday, endToday, endWeek),
      )
      .slice(0, priorityLimit)
      .map((task) =>
        this.mapTaskAttentionItem(
          task,
          startToday,
          endToday,
          endWeek,
        ),
      );

    const completed = this.countTaskStatus(tasks, TaskStatus.Done);

    return {
      total: tasks.length,
      open: openTasks.length,
      todo: this.countTaskStatus(tasks, TaskStatus.Todo),
      inProgress: this.countTaskStatus(tasks, TaskStatus.InProgress),
      inReview: this.countTaskStatus(tasks, TaskStatus.InReview),
      approved: this.countTaskStatus(tasks, TaskStatus.Approved),
      waiting: this.countTaskStatus(tasks, TaskStatus.Waiting),
      blocked: openTasks.filter(
        (task) =>
          task.isBlocked || task.status === TaskStatus.Blocked,
      ).length,
      done: completed,
      cancelled: this.countTaskStatus(tasks, TaskStatus.Cancelled),
      overdue: overdueTasks.length,
      dueToday: dueTodayTasks.length,
      dueThisWeek: dueThisWeekTasks.length,
      withoutAssignee: openTasks.filter(
        (task) => task.assigneeId === null,
      ).length,
      highPriority: openTasks.filter(
        (task) => task.priority === TaskPriority.High,
      ).length,
      urgent: openTasks.filter(
        (task) => task.priority === TaskPriority.Urgent,
      ).length,
      estimatedMinutes: tasks.reduce(
        (sum, task) => sum + (task.estimatedMinutes ?? 0),
        0,
      ),
      trackedMinutes: tasks.reduce(
        (sum, task) => sum + task.trackedMinutes,
        0,
      ),
      completionRate:
        tasks.length > 0
          ? Math.round((completed / tasks.length) * 100)
          : 0,
      last3Months: this.buildLast3MonthsSummary(tasks, now),
      attentionItems,
    };
  }

  private buildLast3MonthsSummary(
    tasks: AgencyTask[],
    now: Date,
  ): TasksDashboardLast3Months {
    const periodStart = this.addDays(now, -90);

    const nonPrivateTasks = tasks.filter(
      (task) => task.visibility !== TaskVisibility.Private,
    );

    return {
      registered: nonPrivateTasks.filter(
        (task) =>
          task.createdAt.getTime() >= periodStart.getTime() &&
          task.createdAt.getTime() <= now.getTime(),
      ).length,
      completed: nonPrivateTasks.filter(
        (task) =>
          task.status === TaskStatus.Done &&
          task.completedAt !== null &&
          task.completedAt.getTime() >= periodStart.getTime() &&
          task.completedAt.getTime() <= now.getTime(),
      ).length,
    };
  }

  private buildPersonalTasksSummary(
    tasks: AgencyTask[],
    dueSoonDays: number,
    priorityLimit: number,
  ): PersonalTasksDashboardSummary {
    const now = new Date();
    const startToday = this.startOfDay(now);
    const endToday = this.endOfDay(now);
    const endWeek = this.endOfDay(this.addDays(now, dueSoonDays));
    const periodStart = this.startOfDay(this.addDays(now, -30));

    const openTasks = tasks.filter(
      (task) => !CLOSED_TASK_STATUSES.includes(task.status),
    );

    const attentionItems = openTasks
      .filter((task) => {
        const dueThisWeek =
          task.dueDate !== null &&
          task.dueDate.getTime() <= endWeek.getTime();

        return (
          dueThisWeek ||
          task.isBlocked ||
          task.priority === TaskPriority.High ||
          task.priority === TaskPriority.Urgent
        );
      })
      .sort((a, b) =>
        this.taskAttentionScore(b, startToday, endToday, endWeek) -
        this.taskAttentionScore(a, startToday, endToday, endWeek),
      )
      .slice(0, priorityLimit)
      .map((task) =>
        this.mapTaskAttentionItem(
          task,
          startToday,
          endToday,
          endWeek,
        ),
      );

    return {
      total: tasks.length,
      open: openTasks.length,
      overdue: openTasks.filter(
        (task) =>
          task.dueDate !== null &&
          task.dueDate.getTime() < startToday.getTime(),
      ).length,
      dueToday: openTasks.filter(
        (task) =>
          task.dueDate !== null &&
          task.dueDate.getTime() >= startToday.getTime() &&
          task.dueDate.getTime() <= endToday.getTime(),
      ).length,
      dueThisWeek: openTasks.filter(
        (task) =>
          task.dueDate !== null &&
          task.dueDate.getTime() >= startToday.getTime() &&
          task.dueDate.getTime() <= endWeek.getTime(),
      ).length,
      blocked: openTasks.filter(
        (task) =>
          task.isBlocked || task.status === TaskStatus.Blocked,
      ).length,
      completedInPeriod: tasks.filter(
        (task) =>
          task.status === TaskStatus.Done &&
          task.completedAt !== null &&
          task.completedAt.getTime() >= periodStart.getTime() &&
          task.completedAt.getTime() <= now.getTime(),
      ).length,
      estimatedMinutes: tasks.reduce(
        (sum, task) => sum + (task.estimatedMinutes ?? 0),
        0,
      ),
      trackedMinutes: tasks.reduce(
        (sum, task) => sum + task.trackedMinutes,
        0,
      ),
      attentionItems,
    };
  }

  private buildSubtasksSummary(
    loaded: LoadedSubtasks,
    assigneeNames: Map<string, string>,
    dueSoonDays: number,
    priorityLimit: number,
  ): SubtasksDashboardSummary {
    const now = new Date();
    const startToday = this.startOfDay(now);
    const endToday = this.endOfDay(now);
    const endWeek = this.endOfDay(this.addDays(now, dueSoonDays));

    const mapped = loaded.items
      .filter((item) => loaded.taskById.has(item.taskId))
      .map((item) =>
        this.mapSubtaskAttentionItem(
          item,
          loaded.taskById.get(item.taskId)!,
          assigneeNames,
          startToday,
          endToday,
          endWeek,
        ),
      );

    const sorted = [...mapped].sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (a.dueDate === null && b.dueDate === null) return 0;
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

    return {
      total: mapped.length,
      overdue: mapped.filter((item) => item.overdue).length,
      dueToday: mapped.filter((item) => item.dueToday).length,
      dueThisWeek: mapped.filter((item) => item.dueThisWeek).length,
      attentionItems: sorted.slice(0, priorityLimit),
    };
  }

  private mapSubtaskAttentionItem(
    item: AgencyTaskChecklistItem,
    task: AgencyTask,
    assigneeNames: Map<string, string>,
    startToday: Date,
    endToday: Date,
    endWeek: Date,
  ): SubtaskDashboardAttentionItem {
    const due = item.dueDate;

    return {
      id: item.id,
      title: item.title,
      taskId: item.taskId,
      taskTitle: task.title,
      projectId: task.projectId,
      clientId: task.clientId,
      assigneeId: item.assigneeId,
      assigneeName: item.assigneeId
        ? (assigneeNames.get(item.assigneeId) ?? null)
        : null,
      status: item.status,
      dueDate: due?.toISOString() ?? null,
      overdue: due !== null && due.getTime() < startToday.getTime(),
      dueToday:
        due !== null &&
        due.getTime() >= startToday.getTime() &&
        due.getTime() <= endToday.getTime(),
      dueThisWeek:
        due !== null &&
        due.getTime() >= startToday.getTime() &&
        due.getTime() <= endWeek.getTime(),
      href: task.projectId
        ? `/projects/${task.projectId}/tasks/${item.taskId}/subtask/${item.id}`
        : `/projects/tasks/${item.taskId}/subtask/${item.id}`,
    };
  }

  private mapProjectAttentionItem(
    project: AgencyProject,
    now: Date,
    dueSoonLimit: Date,
  ): ProjectDashboardAttentionItem {
    return {
      id: project.id,
      name: project.name,
      clientId: project.clientId,
      ownerId: project.ownerId,
      status: project.status,
      priority: project.priority,
      progress: this.clampProgress(project.progress),
      dueDate: project.dueDate?.toISOString() ?? null,
      overdue:
        project.dueDate !== null &&
        project.dueDate.getTime() < now.getTime(),
      dueSoon:
        project.dueDate !== null &&
        project.dueDate.getTime() >= now.getTime() &&
        project.dueDate.getTime() <= dueSoonLimit.getTime(),
      href: `/projects/${project.id}`,
    };
  }

  private mapTaskAttentionItem(
    task: AgencyTask,
    startToday: Date,
    endToday: Date,
    endWeek: Date,
  ): TaskDashboardAttentionItem {
    return {
      id: task.id,
      title: task.title,
      projectId: task.projectId,
      clientId: task.clientId,
      assigneeId: task.assigneeId,
      assigneeName: null,
      status: task.status,
      priority: task.priority,
      visibility: task.visibility,
      dueDate: task.dueDate?.toISOString() ?? null,
      overdue:
        task.dueDate !== null &&
        task.dueDate.getTime() < startToday.getTime(),
      dueToday:
        task.dueDate !== null &&
        task.dueDate.getTime() >= startToday.getTime() &&
        task.dueDate.getTime() <= endToday.getTime(),
      dueThisWeek:
        task.dueDate !== null &&
        task.dueDate.getTime() >= startToday.getTime() &&
        task.dueDate.getTime() <= endWeek.getTime(),
      blocked: task.isBlocked || task.status === TaskStatus.Blocked,
      blockedReason: task.blockedReason,
      estimatedMinutes: task.estimatedMinutes,
      trackedMinutes: task.trackedMinutes,
      href: `/projects/tasks/${task.id}`,
    };
  }

  private projectAttentionScore(
    project: AgencyProject,
    now: Date,
    dueSoonLimit: Date,
  ) {
    let score = 0;

    if (
      project.dueDate !== null &&
      project.dueDate.getTime() < now.getTime()
    ) {
      score += 100;
    } else if (
      project.dueDate !== null &&
      project.dueDate.getTime() <= dueSoonLimit.getTime()
    ) {
      score += 40;
    }

    if (project.priority === ProjectPriority.Urgent) score += 60;
    if (project.priority === ProjectPriority.High) score += 30;
    if (project.ownerId === null) score += 25;
    if (project.status === ProjectStatus.Paused) score += 20;
    if (project.progress < 25) score += 10;

    return score;
  }

  private taskAttentionScore(
    task: AgencyTask,
    startToday: Date,
    endToday: Date,
    endWeek: Date,
  ) {
    let score = 0;

    if (
      task.dueDate !== null &&
      task.dueDate.getTime() < startToday.getTime()
    ) {
      score += 100;
    } else if (
      task.dueDate !== null &&
      task.dueDate.getTime() <= endToday.getTime()
    ) {
      score += 70;
    } else if (
      task.dueDate !== null &&
      task.dueDate.getTime() <= endWeek.getTime()
    ) {
      score += 35;
    }

    if (task.isBlocked || task.status === TaskStatus.Blocked) {
      score += 80;
    }

    if (task.priority === TaskPriority.Urgent) score += 60;
    if (task.priority === TaskPriority.High) score += 30;
    if (task.assigneeId === null) score += 20;

    return score;
  }

  private countProjectStatus(
    projects: AgencyProject[],
    status: ProjectStatus,
  ) {
    return projects.filter((project) => project.status === status).length;
  }

  private countTaskStatus(tasks: AgencyTask[], status: TaskStatus) {
    return tasks.filter((task) => task.status === status).length;
  }

  private normalizePositiveInteger(
    value: number | undefined,
    fallback: number,
  ) {
    if (!Number.isFinite(value) || !value || value < 1) {
      return fallback;
    }

    return Math.floor(value);
  }

  private clampProgress(value: number) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  private startOfDay(value: Date) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private endOfDay(value: Date) {
    const date = new Date(value);
    date.setHours(23, 59, 59, 999);
    return date;
  }

  private addDays(value: Date, days: number) {
    const date = new Date(value);
    date.setDate(date.getDate() + days);
    return date;
  }
}
