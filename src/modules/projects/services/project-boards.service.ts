import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, Repository } from 'typeorm';
import {
  AgencyPersonalTaskStage,
  AgencyProject,
  AgencyProjectStage,
  AgencyTask,
  AgencyTaskStage,
} from '../entities';
import { TaskVisibility } from '../enums';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

type BoardColumn<TCard> = {
  id: string;
  name: string;
  color: string | null;
  position: number;
  cards: TCard[];
};

type BoardResponse<TCard> = {
  columns: BoardColumn<TCard>[];
  unassigned: {
    id: null;
    name: string;
    cards: TCard[];
  };
};

type ProjectBoardCard = AgencyProject & {
  taskCount: number;
  clientName: string | null;
};

type TaskBoardCard = AgencyTask & {
  checklistTotal: number;
  checklistDone: number;
};

export type ChecklistItemSummary = {
  id: string;
  taskId: string;
  isDone: boolean;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class ProjectBoardsService {
  constructor(
    @InjectRepository(AgencyProject, 'agency')
    private readonly projectsRepository: Repository<AgencyProject>,

    @InjectRepository(AgencyProjectStage, 'agency')
    private readonly projectStagesRepository: Repository<AgencyProjectStage>,

    @InjectRepository(AgencyTask, 'agency')
    private readonly tasksRepository: Repository<AgencyTask>,

    @InjectRepository(AgencyTaskStage, 'agency')
    private readonly taskStagesRepository: Repository<AgencyTaskStage>,

    @InjectRepository(AgencyPersonalTaskStage, 'agency')
    private readonly personalTaskStagesRepository: Repository<AgencyPersonalTaskStage>,
  ) {}

  async listAllChecklistItems(context: RequestContext): Promise<ChecklistItemSummary[]> {
    const rows = await this.tasksRepository.manager
      .createQueryBuilder()
      .select('item.id', 'id')
      .addSelect('item.task_id', 'taskId')
      .addSelect('item.is_done', 'isDone')
      .addSelect('item.created_at', 'createdAt')
      .addSelect('item.updated_at', 'updatedAt')
      .from('agency_task_checklist_items', 'item')
      .where('item.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('item.workspace_id = :workspaceId', { workspaceId: context.workspaceId })
      .getRawMany<ChecklistItemSummary>();

    return rows;
  }

  async getProjectsBoard(context: RequestContext): Promise<BoardResponse<ProjectBoardCard>> {
    const [stages, projects] = await Promise.all([
      this.projectStagesRepository.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          isArchived: false,
        },
        order: {
          position: 'ASC',
          createdAt: 'ASC',
        },
      }),
      this.projectsRepository.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          archivedAt: IsNull(),
        },
        order: {
          updatedAt: 'DESC',
          createdAt: 'DESC',
        },
      }),
    ]);

    const [taskCounts, clientNames] = await Promise.all([
      this.getProjectTaskCounts(context, projects.map((project) => project.id)),
      this.getProjectClientNames(
        context,
        projects
          .map((project) => project.clientId)
          .filter((clientId): clientId is string => Boolean(clientId)),
      ),
    ]);
    const cards = projects.map((project) =>
      Object.assign(project, {
        taskCount: taskCounts.get(project.id) ?? 0,
        clientName: project.clientId ? clientNames.get(project.clientId) ?? null : null,
      }),
    );

    return this.buildBoard(stages, cards, 'Sem estágio');
  }

  async getWorkspaceTasksBoard(context: RequestContext): Promise<BoardResponse<TaskBoardCard>> {
    const tasks = await this.tasksRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        archivedAt: IsNull(),
        visibility: TaskVisibility.Workspace,
      },
      order: {
        updatedAt: 'DESC',
        createdAt: 'DESC',
      },
    });
    const stages = await this.listTaskStagesForBoard(context, null, tasks);

    return this.buildBoard(stages, await this.withChecklistCounts(context, tasks), 'Sem estágio');
  }

  async getProjectTasksBoard(context: RequestContext, projectId: string): Promise<BoardResponse<TaskBoardCard>> {
    const tasks = await this.tasksRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        projectId,
        archivedAt: IsNull(),
      },
      order: { updatedAt: 'DESC', createdAt: 'DESC' },
    });
    const stages = await this.listTaskStagesForBoard(context, projectId, tasks);

    return this.buildBoard(stages, await this.withChecklistCounts(context, tasks), 'Sem estágio');
  }

  private listTaskStagesForBoard(
    context: RequestContext,
    projectId: string | null,
    tasks: AgencyTask[],
  ) {
    const referencedStageIds = Array.from(
      new Set(tasks.map((task) => task.stageId).filter((stageId): stageId is string => Boolean(stageId))),
    );
    const qb = this.taskStagesRepository
      .createQueryBuilder('stage')
      .where('stage.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('stage.workspace_id = :workspaceId', { workspaceId: context.workspaceId })
      .andWhere('stage.is_archived = false')
      .andWhere(
        new Brackets((stageQb) => {
          if (projectId) {
            stageQb.where('stage.project_id = :projectId', { projectId });
          } else {
            stageQb.where('stage.project_id IS NULL');
          }

          if (referencedStageIds.length) {
            stageQb.orWhere('stage.id IN (:...referencedStageIds)', { referencedStageIds });
          }
        }),
      )
      .orderBy('stage.position', 'ASC')
      .addOrderBy('stage.created_at', 'ASC');

    return qb.getMany();
  }

  async getMyTasksBoard(context: RequestContext): Promise<BoardResponse<TaskBoardCard>> {
    const [stages, tasks] = await Promise.all([
      this.personalTaskStagesRepository.find({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          userId: context.userId,
        },
        order: {
          position: 'ASC',
          createdAt: 'ASC',
        },
      }),
      this.tasksRepository.find({
        where: [
          {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            archivedAt: IsNull(),
            assigneeId: context.userId,
          },
          {
            tenantId: context.tenantId,
            workspaceId: context.workspaceId,
            archivedAt: IsNull(),
            createdById: context.userId,
            visibility: TaskVisibility.Private,
          },
        ],
        order: {
          updatedAt: 'DESC',
          createdAt: 'DESC',
        },
      }),
    ]);

    return this.buildPersonalTasksBoard(stages, await this.withChecklistCounts(context, tasks));
  }

  private async getProjectTaskCounts(context: RequestContext, projectIds: string[]) {
    const counts = new Map<string, number>();

    if (!projectIds.length) {
      return counts;
    }

    const rows = await this.tasksRepository
      .createQueryBuilder('task')
      .select('task.project_id', 'projectId')
      .addSelect('COUNT(task.id)', 'taskCount')
      .where('task.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('task.workspace_id = :workspaceId', { workspaceId: context.workspaceId })
      .andWhere('task.archived_at IS NULL')
      .andWhere('task.project_id IN (:...projectIds)', { projectIds })
      .groupBy('task.project_id')
      .getRawMany<{ projectId: string; taskCount: string }>();

    rows.forEach((row) => {
      counts.set(row.projectId, Number(row.taskCount));
    });

    return counts;
  }

  private async getProjectClientNames(context: RequestContext, clientIds: string[]) {
    const uniqueClientIds = Array.from(new Set(clientIds));
    const names = new Map<string, string>();

    if (!uniqueClientIds.length) {
      return names;
    }

    const rows = await this.projectsRepository.manager
      .createQueryBuilder()
      .select('client.id', 'id')
      .addSelect('client.display_name', 'name')
      .from('agency_clients', 'client')
      .where('client.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('client.workspace_id = :workspaceId', { workspaceId: context.workspaceId })
      .andWhere('client.id IN (:...clientIds)', { clientIds: uniqueClientIds })
      .getRawMany<{ id: string; name: string }>();

    rows.forEach((row) => {
      names.set(row.id, row.name);
    });

    return names;
  }

  private async withChecklistCounts(
    context: RequestContext,
    tasks: AgencyTask[],
  ): Promise<TaskBoardCard[]> {
    if (!tasks.length) {
      return [];
    }

    const rows = await this.tasksRepository.manager
      .createQueryBuilder()
      .select('item.task_id', 'taskId')
      .addSelect('COUNT(item.id)', 'total')
      .addSelect('SUM(CASE WHEN item.is_done THEN 1 ELSE 0 END)', 'done')
      .from('agency_task_checklist_items', 'item')
      .where('item.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('item.workspace_id = :workspaceId', { workspaceId: context.workspaceId })
      .andWhere('item.task_id IN (:...taskIds)', { taskIds: tasks.map((task) => task.id) })
      .groupBy('item.task_id')
      .getRawMany<{ taskId: string; total: string; done: string }>();

    const counts = new Map(
      rows.map((row) => [
        row.taskId,
        {
          checklistTotal: Number(row.total),
          checklistDone: Number(row.done),
        },
      ]),
    );

    return tasks.map((task) =>
      Object.assign(task, counts.get(task.id) ?? { checklistTotal: 0, checklistDone: 0 }),
    );
  }

  private buildBoard<
    TStage extends { id: string; name: string; color: string | null; position: number },
    TCard extends { stageId: string | null }
  >(
    stages: TStage[],
    cards: TCard[],
    unassignedName: string,
  ): BoardResponse<TCard> {
    const stageIds = new Set(stages.map((stage) => stage.id));
    const fallbackStageId = stages[0]?.id ?? null;
    const columns = stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      color: stage.color,
      position: stage.position,
      cards: cards.filter(
        (card) =>
          card.stageId === stage.id ||
          (stage.id === fallbackStageId &&
            typeof card.stageId === 'string' &&
            !stageIds.has(card.stageId)),
      ),
    }));

    const unassignedCards = cards.filter(
      (card) =>
        !card.stageId ||
        (!fallbackStageId && typeof card.stageId === 'string' && !stageIds.has(card.stageId)),
    );

    return {
      columns,
      unassigned: {
        id: null,
        name: unassignedName,
        cards: unassignedCards,
      },
    };
  }

  private buildPersonalTasksBoard(
    stages: AgencyPersonalTaskStage[],
    tasks: TaskBoardCard[],
  ): BoardResponse<TaskBoardCard> {
    const columns = stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      color: stage.color,
      position: stage.position,
      cards: tasks.filter((task) => task.personalStageId === stage.id),
    }));

    const unassignedCards = tasks.filter((task) => !task.personalStageId);

    return {
      columns,
      unassigned: {
        id: null,
        name: 'Sem estágio pessoal',
        cards: unassignedCards,
      },
    };
  }
}
