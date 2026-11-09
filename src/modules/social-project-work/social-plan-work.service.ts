import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull } from 'typeorm';
import {
  resolveCompanyAwareScope,
  type CompanyAwareScope,
} from '../../common/context/company-aware-scope';
import type { RequestContext } from '../../common/context/request-context.interface';
import { approvalScopeWhere } from '../social-approvals/approval-scope';
import { PlatformPermissionService } from '../permissions';
import {
  AgencyProject,
  AgencyProjectStage,
  AgencyTask,
  AgencyTaskChecklistItem,
  AgencyTaskStage,
  TaskStatus,
} from '../projects';
import { ProjectsCrudService } from '../projects/services/projects-crud.service';
import { TasksCrudService } from '../projects/services/tasks-crud.service';
import { TaskWorkspaceService } from '../projects/services/task-workspace.service';
import { CREATIVE_PRODUCTION_PERMISSIONS as P } from '../social-creative-studio/creative-production.permissions';
import { CreativeProductionService } from '../social-creative-studio/creative-production.service';
import {
  SocialContentItemEntity,
  SocialPlanEntity,
} from '../social-planner/entities';
import {
  SocialPlanContentChangeRegistry,
  type SocialPlanContentChange,
} from '../social-planner/services/social-plan-content-change.port';
import type {
  CreatePlanWorkLinkDto,
  PlanWorkOptionsQueryDto,
} from './dto/social-project-work.dto';
import {
  SocialContentWorkLinkEntity,
  SocialPlanWorkLinkEntity,
  type SocialContentWorkStepKind,
} from './entities';
import {
  permissionIdentity,
  socialNotContracted,
  SocialWorkGateService,
} from './social-work-gate.service';
import { SocialWorkStatusService } from './social-work-status.service';

const PROJECT_CREATE = 'agency.projects.project.create.department';
const TITLE_MAX = 180;

type WorkRow = {
  stepKind: SocialContentWorkStepKind;
  taskId: string;
  subtaskId: string | null;
};

function conflict(code: string, message: string) {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code,
    message,
  });
}

/** Noon UTC: the same calendar day in every timezone the agency works in. */
function dueDateOf(plannedDate: string | null): string | null {
  return plannedDate ? `${plannedDate}T12:00:00.000Z` : null;
}

function scopeOf(link: SocialPlanWorkLinkEntity): CompanyAwareScope {
  return {
    tenantId: link.tenantId,
    workspaceId: link.workspaceId,
    agencyClientId: link.agencyClientId,
    companyContextId: link.companyContextId,
  };
}

/**
 * The generated work is the link author's, and module-wide on purpose: a
 * Member's narrowing would otherwise make every generated task theirs.
 */
function workContext(link: SocialPlanWorkLinkEntity) {
  return {
    tenantId: link.tenantId,
    workspaceId: link.workspaceId,
    userId: link.createdByUserId,
    role: 'owner',
  };
}

/**
 * D-25 — a plan linked to Agency work, and the work that follows its items.
 *
 * Idempotent by construction: one link row per item and step, written under a
 * per-plan lock, decides what already exists. The Projects services still own
 * every task and subtask written here.
 */
@Injectable()
export class SocialPlanWorkService implements OnModuleInit {
  private readonly logger = new Logger(SocialPlanWorkService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly tasks: TasksCrudService,
    private readonly checklist: TaskWorkspaceService,
    private readonly projects: ProjectsCrudService,
    private readonly production: CreativeProductionService,
    private readonly changes: SocialPlanContentChangeRegistry,
    private readonly status: SocialWorkStatusService,
    private readonly permissions: PlatformPermissionService,
    private readonly gate: SocialWorkGateService,
  ) {}

  onModuleInit(): void {
    this.changes.register((change) => this.onContentChanged(change));
  }

  // ── Modal ───────────────────────────────────────────────────────────────

  async options(ctx: RequestContext, query: PlanWorkOptionsQueryDto) {
    const scope = resolveCompanyAwareScope(ctx);
    const available =
      (await this.gate.scopeAvailable(ctx, scope)) &&
      (await this.permissions.can(permissionIdentity(ctx), P.taskCreate));
    if (!available) return { available: false, projects: [] };
    const { items } = await this.production.projectCandidatesForScope(
      scope,
      query,
    );
    return { available: true, projects: items };
  }

  async projectStages(ctx: RequestContext, projectId: string) {
    const scope = resolveCompanyAwareScope(ctx);
    if (!(await this.gate.scopeAvailable(ctx, scope)))
      throw socialNotContracted();
    await this.production.requireProjectInScope(scope, projectId);
    const stages = await this.dataSource.manager
      .getRepository(AgencyTaskStage)
      .find({
        where: {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          projectId,
          isArchived: false,
        },
        order: { position: 'ASC', createdAt: 'ASC' },
      });
    return {
      stages: stages.map(({ id, name, position }) => ({ id, name, position })),
    };
  }

  async getLink(ctx: RequestContext, planId: string) {
    const scope = resolveCompanyAwareScope(ctx);
    await this.requirePlan(scope, planId);
    const link = await this.links().findOne({
      where: { ...approvalScopeWhere(scope), planId },
    });
    return { link: link ? await this.view(link) : null };
  }

  async createLink(
    ctx: RequestContext,
    planId: string,
    dto: CreatePlanWorkLinkDto,
  ) {
    const scope = resolveCompanyAwareScope(ctx);
    await this.gate.assertScope(ctx, scope);
    const identity = permissionIdentity(ctx);
    await this.permissions.assertCan(identity, P.taskCreate);
    if (dto.mode === 'project_created')
      await this.permissions.assertCan(identity, PROJECT_CREATE);
    const plan = await this.requirePlan(scope, planId);
    if (plan.status === 'archived')
      throw conflict(
        'approval_content_unavailable',
        'Este plano está arquivado.',
      );

    const outcome = await this.withPlanLock(plan.id, async () => {
      const existing = await this.links().findOne({
        where: { planId: plan.id },
      });
      if (existing) {
        if (existing.mode !== dto.mode)
          throw conflict(
            'plan_work_link_exists',
            'Este plano já está vinculado de outra forma.',
          );
        return { link: existing, changed: false };
      }
      return {
        link: await this.createLinkRow(scope, plan, identity.userId, dto),
        changed: true,
      };
    });
    if (outcome.changed) await this.materialize(outcome.link, null);
    return { changed: outcome.changed, link: await this.view(outcome.link) };
  }

  /** R-13 to R-15. A stage is only ever one of the chosen project's. */
  private async createLinkRow(
    scope: CompanyAwareScope,
    plan: SocialPlanEntity,
    userId: string,
    dto: CreatePlanWorkLinkDto,
  ): Promise<SocialPlanWorkLinkEntity> {
    const context = {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      userId,
      role: 'owner',
    };
    let projectId: string;
    let createdProject = false;
    if (dto.mode === 'project_created') {
      const firstStage = await this.dataSource.manager
        .getRepository(AgencyProjectStage)
        .findOne({
          where: {
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            isArchived: false,
          },
          order: { position: 'ASC', createdAt: 'ASC' },
        });
      const project = await this.projects.create(context, {
        name: (dto.projectName?.trim() || plan.title).slice(0, TITLE_MAX),
        clientId: scope.agencyClientId,
        stageId: firstStage?.id ?? null,
      });
      projectId = project.id;
      createdProject = true;
    } else {
      if (!dto.projectId)
        throw conflict('plan_work_project_required', 'Escolha um projeto.');
      await this.production.requireProjectInScope(scope, dto.projectId);
      projectId = dto.projectId;
    }
    if (dto.projectStageId) await this.requireStage(scope, projectId, dto);

    let parentTaskId: string | null = null;
    try {
      if (dto.mode === 'task_created') {
        const task = await this.tasks.createWorkspaceTask(context, {
          title: (dto.taskTitle?.trim() || plan.title).slice(0, TITLE_MAX),
          projectId,
          projectStageId: dto.projectStageId ?? undefined,
          clientId: scope.agencyClientId,
        });
        parentTaskId = task.id;
      }
      return await this.links().save(
        this.links().create({
          ...scope,
          planId: plan.id,
          mode: dto.mode,
          projectId,
          projectStageId: dto.projectStageId ?? null,
          parentTaskId,
          createdByUserId: userId,
        }),
      );
    } catch (error) {
      // Owner services commit on their own: leave no orphan behind (CS5).
      if (parentTaskId)
        await this.tasks.archive(context, parentTaskId).catch(() => undefined);
      if (createdProject)
        await this.projects.archive(context, projectId).catch(() => undefined);
      throw error;
    }
  }

  private async requireStage(
    scope: CompanyAwareScope,
    projectId: string,
    dto: CreatePlanWorkLinkDto,
  ): Promise<void> {
    const stage = await this.dataSource.manager
      .getRepository(AgencyTaskStage)
      .findOne({
        where: {
          id: dto.projectStageId!,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          projectId,
          isArchived: false,
        },
      });
    if (!stage)
      throw new NotFoundException({
        code: 'project_stage_not_found',
        message: 'Estágio não encontrado neste projeto.',
      });
  }

  // ── Materialization ─────────────────────────────────────────────────────

  private async onContentChanged(
    change: SocialPlanContentChange,
  ): Promise<void> {
    const ids = [...change.contentItemIds];
    const scope = {
      tenantId: change.tenantId,
      workspaceId: change.workspaceId,
    };
    const manager = this.dataSource.manager;
    const [items, rows] = await Promise.all([
      manager.getRepository(SocialContentItemEntity).find({
        where: { ...scope, id: In(ids) },
        select: { id: true, planId: true },
      }),
      // A hard-deleted draft is only known through the link it left.
      this.contentLinks().find({
        where: { ...scope, contentItemId: In(ids) },
      }),
    ]);
    const planIds = [
      ...new Set([
        ...items.map((item) => item.planId),
        ...rows.map((row) => row.planId),
      ]),
    ];
    if (planIds.length === 0) return;
    const links = await this.links().find({
      where: { ...scope, planId: In(planIds) },
    });
    for (const link of links) await this.materialize(link, ids);
  }

  /** Repairs the plan's work and every status, for a missed observer call. */
  async reconcile(ctx: RequestContext, planId: string) {
    const scope = resolveCompanyAwareScope(ctx);
    await this.gate.assertScope(ctx, scope);
    await this.requirePlan(scope, planId);
    const link = await this.links().findOne({
      where: { ...approvalScopeWhere(scope), planId },
    });
    if (!link)
      throw new NotFoundException('Este plano não tem vínculo com Projetos.');
    const created = await this.materialize(link, null);
    const rows = await this.contentLinks().find({
      where: { planId },
      select: { taskId: true },
    });
    const taskIds = [
      ...new Set([
        ...rows.map((row) => row.taskId),
        ...(link.parentTaskId ? [link.parentTaskId] : []),
      ]),
    ];
    for (const taskId of taskIds)
      await this.status.syncTask(link.tenantId, link.workspaceId, taskId);
    return { itemsMaterialized: created, tasksSynced: taskIds.length };
  }

  /**
   * Which items to look at: every item of the plan, or only those that just
   * changed. One failing item never stops the others, and its next run
   * repeats exactly what is still missing.
   */
  async materialize(
    link: SocialPlanWorkLinkEntity,
    onlyContentIds: readonly string[] | null,
  ): Promise<number> {
    return this.withPlanLock(link.planId, async () => {
      const where = {
        tenantId: link.tenantId,
        workspaceId: link.workspaceId,
        planId: link.planId,
      };
      const filter = onlyContentIds ? [...onlyContentIds] : null;
      const [items, rows] = await Promise.all([
        this.dataSource.manager.getRepository(SocialContentItemEntity).find({
          where: { ...where, ...(filter ? { id: In(filter) } : {}) },
          order: { plannedDate: 'ASC', sortOrder: 'ASC', createdAt: 'ASC' },
        }),
        this.contentLinks().find({
          where: {
            ...where,
            ...(filter ? { contentItemId: In(filter) } : {}),
          },
        }),
      ]);
      const itemById = new Map(items.map((item) => [item.id, item]));
      const rowsByItem = new Map<string, SocialContentWorkLinkEntity[]>();
      for (const row of rows)
        rowsByItem.set(row.contentItemId, [
          ...(rowsByItem.get(row.contentItemId) ?? []),
          row,
        ]);

      let created = 0;
      for (const id of new Set([...itemById.keys(), ...rowsByItem.keys()]))
        try {
          if (
            await this.reconcileItem(
              link,
              id,
              itemById.get(id),
              rowsByItem.get(id) ?? [],
            )
          )
            created += 1;
        } catch (error) {
          this.logger.warn(
            `plan work skipped for item ${id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      return created;
    });
  }

  private async reconcileItem(
    link: SocialPlanWorkLinkEntity,
    contentItemId: string,
    item: SocialContentItemEntity | undefined,
    rows: SocialContentWorkLinkEntity[],
  ): Promise<boolean> {
    const removed =
      !item ||
      Boolean(item.deletedAt) ||
      Boolean(item.archivedAt) ||
      item.calendarOnly ||
      item.planningStatus === 'cancelled';
    if (rows.length === 0) {
      if (removed || item.planningStatus === 'posted') return false;
      await this.createItemWork(link, item);
      return true;
    }
    if (removed) {
      await this.cancelItemWork(link, rows);
      return false;
    }
    if (rows.some((row) => row.cancelledAt))
      await this.reactivateItemWork(link, rows);
    await this.syncDueDate(link, rows, item);
    return false;
  }

  private async createItemWork(
    link: SocialPlanWorkLinkEntity,
    item: SocialContentItemEntity,
  ): Promise<void> {
    const context = workContext(link);
    const dueDate = dueDateOf(item.plannedDate);
    const work: WorkRow[] = [];
    let createdTaskId: string | null = null;
    try {
      if (link.parentTaskId) {
        const subtask = await this.checklist.createChecklistItem(
          context,
          link.parentTaskId,
          { title: item.title.slice(0, TITLE_MAX), dueDate },
        );
        work.push({
          stepKind: 'item',
          taskId: link.parentTaskId,
          subtaskId: subtask.id,
        });
      } else {
        const task = await this.tasks.createWorkspaceTask(context, {
          title: item.title.slice(0, TITLE_MAX),
          description: `Planner: /social/planner/content/${item.id}`,
          projectId: link.projectId,
          projectStageId: link.projectStageId ?? undefined,
          clientId: link.agencyClientId,
          dueDate,
        });
        createdTaskId = task.id;
        const [copy, creative] = [
          await this.checklist.createChecklistItem(context, task.id, {
            title: 'Copy',
            position: 0,
            dueDate,
          }),
          await this.checklist.createChecklistItem(context, task.id, {
            title: 'Criativo',
            position: 1,
            dueDate,
          }),
        ];
        work.push(
          { stepKind: 'copy', taskId: task.id, subtaskId: copy.id },
          { stepKind: 'creative', taskId: task.id, subtaskId: creative.id },
        );
      }
      await this.contentLinks()
        .createQueryBuilder()
        .insert()
        .values(
          work.map((row) => ({
            ...scopeOf(link),
            planId: link.planId,
            contentItemId: item.id,
            stepKind: row.stepKind,
            taskId: row.taskId,
            subtaskId: row.subtaskId,
            plannedDate: item.plannedDate,
          })),
        )
        .execute();
    } catch (error) {
      if (createdTaskId)
        await this.tasks.archive(context, createdTaskId).catch(() => undefined);
      throw error;
    }
    const creativeRow = work.find((row) => row.stepKind !== 'copy')!;
    await this.production
      .attachMaterializedTask(scopeOf(link), item.id, link.createdByUserId, {
        taskId: creativeRow.taskId,
        subtaskId: creativeRow.subtaskId,
        projectId: link.projectId,
      })
      .catch((error: unknown) =>
        this.logger.warn(
          `production link skipped for item ${item.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
  }

  /** D-25: cancelled, never deleted, and a person's `done` is left alone. */
  private async cancelItemWork(
    link: SocialPlanWorkLinkEntity,
    rows: SocialContentWorkLinkEntity[],
  ): Promise<void> {
    if (rows.every((row) => row.cancelledAt)) return;
    const context = workContext(link);
    if (link.parentTaskId) {
      for (const row of rows)
        if (row.subtaskId)
          await this.setSubtask(context, row, 'cancelled', ['done']);
    } else {
      await this.setTask(context, rows[0].taskId, TaskStatus.Cancelled, [
        TaskStatus.Done,
        TaskStatus.Cancelled,
        TaskStatus.Archived,
      ]);
    }
    await this.contentLinks().update(
      { id: In(rows.map((row) => row.id)) },
      { cancelledAt: new Date() },
    );
    await this.status.syncTask(link.tenantId, link.workspaceId, rows[0].taskId);
  }

  /** Only work the sync itself cancelled comes back with a restored item. */
  private async reactivateItemWork(
    link: SocialPlanWorkLinkEntity,
    rows: SocialContentWorkLinkEntity[],
  ): Promise<void> {
    const context = workContext(link);
    if (link.parentTaskId) {
      for (const row of rows)
        if (row.subtaskId) {
          const subtask = await this.subtaskRow(row);
          if (subtask?.status === 'cancelled')
            await this.checklist.updateChecklistItem(
              context,
              row.taskId,
              row.subtaskId,
              { status: 'in_progress' },
            );
        }
    } else {
      const task = await this.taskRow(context, rows[0].taskId);
      if (task?.status === TaskStatus.Cancelled)
        await this.tasks.update(context, task.id, {
          status: TaskStatus.InProgress,
        });
    }
    await this.contentLinks().update(
      { id: In(rows.map((row) => row.id)) },
      { cancelledAt: null },
    );
    await this.status.syncTask(link.tenantId, link.workspaceId, rows[0].taskId);
  }

  /** Runs only when the Planner date moved, so a hand-set deadline survives. */
  private async syncDueDate(
    link: SocialPlanWorkLinkEntity,
    rows: SocialContentWorkLinkEntity[],
    item: SocialContentItemEntity,
  ): Promise<void> {
    const planned = item.plannedDate ?? null;
    if (rows[0].plannedDate === planned) return;
    const context = workContext(link);
    const dueDate = dueDateOf(planned);
    if (!link.parentTaskId) {
      const task = await this.taskRow(context, rows[0].taskId);
      if (task) await this.tasks.update(context, task.id, { dueDate });
    }
    for (const row of rows)
      if (row.subtaskId && (await this.subtaskRow(row)))
        await this.checklist.updateChecklistItem(
          context,
          row.taskId,
          row.subtaskId,
          { dueDate },
        );
    await this.contentLinks().update(
      { id: In(rows.map((row) => row.id)) },
      { plannedDate: planned },
    );
  }

  private taskRow(
    context: ReturnType<typeof workContext>,
    taskId: string,
  ): Promise<AgencyTask | null> {
    return this.dataSource.manager.getRepository(AgencyTask).findOne({
      where: {
        id: taskId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        archivedAt: IsNull(),
      },
    });
  }

  private subtaskRow(row: SocialContentWorkLinkEntity) {
    return this.dataSource.manager
      .getRepository(AgencyTaskChecklistItem)
      .findOne({
        where: {
          id: row.subtaskId!,
          taskId: row.taskId,
          tenantId: row.tenantId,
          workspaceId: row.workspaceId,
        },
      });
  }

  private async setTask(
    context: ReturnType<typeof workContext>,
    taskId: string,
    status: TaskStatus,
    keep: readonly TaskStatus[],
  ): Promise<void> {
    const task = await this.taskRow(context, taskId);
    if (task && !keep.includes(task.status))
      await this.tasks.update(context, task.id, { status });
  }

  private async setSubtask(
    context: ReturnType<typeof workContext>,
    row: SocialContentWorkLinkEntity,
    status: string,
    keep: readonly string[],
  ): Promise<void> {
    const subtask = await this.subtaskRow(row);
    if (subtask && subtask.status !== status && !keep.includes(subtask.status))
      await this.checklist.updateChecklistItem(
        context,
        row.taskId,
        row.subtaskId!,
        { status },
      );
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private links() {
    return this.dataSource.manager.getRepository(SocialPlanWorkLinkEntity);
  }

  private contentLinks() {
    return this.dataSource.manager.getRepository(SocialContentWorkLinkEntity);
  }

  private async requirePlan(
    scope: CompanyAwareScope,
    planId: string,
  ): Promise<SocialPlanEntity> {
    const plan = await this.dataSource.manager
      .getRepository(SocialPlanEntity)
      .findOne({
        where: {
          ...approvalScopeWhere(scope),
          id: planId,
          deletedAt: IsNull(),
        },
      });
    if (!plan) throw new NotFoundException('Plano não encontrado.');
    return plan;
  }

  /**
   * Serializes everything that writes one plan's work, including the row
   * inserts: a retry waits here and then finds the rows already in place.
   */
  private withPlanLock<T>(planId: string, work: () => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (lock) => {
      await lock.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `social_plan_work:${planId}`,
      ]);
      return work();
    });
  }

  private async view(link: SocialPlanWorkLinkEntity) {
    const manager = this.dataSource.manager;
    const [project, rows] = await Promise.all([
      manager.getRepository(AgencyProject).findOne({
        where: {
          id: link.projectId,
          tenantId: link.tenantId,
          workspaceId: link.workspaceId,
        },
        select: { id: true, name: true },
      }),
      this.contentLinks().find({
        where: { planId: link.planId },
        select: { contentItemId: true, cancelledAt: true },
      }),
    ]);
    const live = new Set(
      rows.filter((row) => !row.cancelledAt).map((row) => row.contentItemId),
    );
    return {
      id: link.id,
      planId: link.planId,
      mode: link.mode,
      projectId: link.projectId,
      projectName: project?.name ?? null,
      projectStageId: link.projectStageId,
      parentTaskId: link.parentTaskId,
      itemsLinked: live.size,
      createdAt: link.createdAt.toISOString(),
    };
  }
}
