import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, IsNull, Repository } from 'typeorm';
import { MediaAssetEntity } from '../../common/media-assets';
import type { RequestContext } from '../../common/context/request-context.interface';
import { PlatformPermissionService } from '../permissions';
import {
  AgencyProject,
  AgencyTask,
  AgencyTaskChecklistItem,
  TaskVisibility,
} from '../projects';
import { TasksCrudService } from '../projects/services/tasks-crud.service';
import { DestinationCreativeService } from '../social-organic/publication/destination-creative.service';
import {
  SocialContentDestinationEntity,
  SocialDestinationCreativeEntity,
} from '../social-planner/entities';
import { databaseConstraint } from './creative-asset.service';
import {
  CreativeProductionReadinessService,
  type CreativeProductionSnapshot,
} from './creative-production-readiness.service';
import { CREATIVE_PRODUCTION_PERMISSIONS as P } from './creative-production.permissions';
import type { CreativeStudioScope } from './creative-studio.scope';
import { CreativeVersionApprovalService } from './creative-version-approval.service';
import type {
  CreateProductionTaskDto,
  HandoffProductionDestinationDto,
  LinkProductionTaskDto,
} from './dto/creative-production.dto';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeProductionEntity,
  CreativeProductionEventEntity,
} from './entities';

export type CreativeProductionAction =
  | 'select_creative'
  | 'clear_selection'
  | 'send_for_approval'
  | 'create_task'
  | 'link_task'
  | 'unlink_task'
  | 'handoff_to_publishing'
  | 'handoff_to_campaigns'
  | 'reconcile';

export type CreativeDestinationHandoff =
  | 'none'
  | 'selected_version'
  | 'other_version'
  | 'manual';

/**
 * CS5-B production view (for CS5-F). A projection only: every field is read
 * from its owner at request time. No provider internals, no media ids beyond
 * what the destination link already exposes, no scope ids.
 */
export type CreativeProductionView = {
  contentItem: {
    id: string;
    title: string;
    planningStatus: string;
    plannedDate: string | null;
    creativeFormat: string | null;
    archived: boolean;
  };
  selectedCreative: {
    assetId: string;
    assetName: string;
    mediaType: 'image' | 'video';
    versionId: string;
    versionNumber: number;
    isAssetCurrentVersion: boolean;
    available: boolean;
    unavailableReason: string | null;
    selectedAt: string | null;
    selectedById: string | null;
    contentPath: string;
    thumbnailPath: string | null;
  } | null;
  approval: {
    required: boolean;
    state: CreativeProductionSnapshot['approval']['state'];
    approvalId: string | null;
    status: string | null;
    currentStage: string | null;
    sentToClientAt: string | null;
    approvedAt: string | null;
  };
  operationalWork: {
    state: 'none' | 'linked' | 'missing' | 'archived' | 'restricted';
    linkKind: string | null;
    taskId: string | null;
    subtaskId: string | null;
    projectId: string | null;
    linkedAt: string | null;
    linkedById: string | null;
    task: {
      id: string;
      title: string;
      status: string;
      dueDate: string | null;
      assigneeId: string | null;
      completedAt: string | null;
    } | null;
    subtask: {
      id: string;
      title: string;
      status: string;
      isDone: boolean;
    } | null;
  };
  destinations: Array<{
    destinationId: string;
    channel: string;
    placement: string;
    plannedAt: string | null;
    handoff: CreativeDestinationHandoff;
    creatives: Array<{
      id: string;
      role: string;
      sortOrder: number;
      source: string;
      creativeVersionId: string | null;
      organicAssetId: string;
    }>;
  }>;
  /**
   * Campaigns has no creative attach API: an ad boosts a publication, and a
   * publication snapshots the media of its destination creative. The exact
   * version therefore reaches Campaigns through the destination handoff.
   */
  campaigns: {
    directAttachAvailable: false;
    path: 'destination_publication_boost';
  };
  readiness: CreativeProductionSnapshot['readiness'];
  history: Array<{
    id: string;
    eventType: string;
    creativeVersionId: string | null;
    actorUserId: string | null;
    payload: Record<string, unknown>;
    occurredAt: string;
  }>;
  availableActions: Array<{
    action: CreativeProductionAction;
    allowed: boolean;
    reason: string | null;
  }>;
};

const HISTORY_LIMIT = 50;

/**
 * CS5-B — orchestration of creative production for one Planner content item.
 *
 * Owns only what no other domain owned: the explicit selection, the link to
 * Agency work and the production history. Every side effect on another domain
 * goes through that domain's own service:
 *
 *   approval   → `CreativeVersionApprovalService` → `SocialApprovalsService`
 *   Planner    → `SocialContentProductionStatusService` (via readiness)
 *   task       → `TasksCrudService`
 *   destination→ `DestinationCreativeService`
 *
 * Nothing here is automatic: no task on generation/upload/approval, no
 * approval on selection, no destination or publication on approval.
 */
@Injectable()
export class CreativeProductionService {
  constructor(
    @InjectRepository(CreativeProductionEntity, 'agency')
    private readonly productions: Repository<CreativeProductionEntity>,
    @InjectRepository(CreativeProductionEventEntity, 'agency')
    private readonly events: Repository<CreativeProductionEventEntity>,
    @InjectRepository(CreativeAssetEntity, 'agency')
    private readonly assets: Repository<CreativeAssetEntity>,
    @InjectRepository(CreativeAssetVersionEntity, 'agency')
    private readonly versions: Repository<CreativeAssetVersionEntity>,
    @InjectRepository(MediaAssetEntity, 'agency')
    private readonly media: Repository<MediaAssetEntity>,
    @InjectRepository(SocialContentDestinationEntity, 'agency')
    private readonly destinations: Repository<SocialContentDestinationEntity>,
    @InjectRepository(SocialDestinationCreativeEntity, 'agency')
    private readonly destinationCreatives: Repository<SocialDestinationCreativeEntity>,
    @InjectRepository(AgencyTask, 'agency')
    private readonly tasks: Repository<AgencyTask>,
    @InjectRepository(AgencyTaskChecklistItem, 'agency')
    private readonly subtasks: Repository<AgencyTaskChecklistItem>,
    @InjectRepository(AgencyProject, 'agency')
    private readonly projects: Repository<AgencyProject>,
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly readiness: CreativeProductionReadinessService,
    private readonly versionApprovals: CreativeVersionApprovalService,
    private readonly destinationOwner: DestinationCreativeService,
    private readonly taskOwner: TasksCrudService,
    private readonly permissions: PlatformPermissionService,
  ) {}

  // ── View ────────────────────────────────────────────────────────────────

  async view(
    ctx: RequestContext,
    scope: CreativeStudioScope,
    contentItemId: string,
  ): Promise<CreativeProductionView> {
    const snapshot = await this.readiness.snapshot(scope, contentItemId);
    const [operationalWork, destinations, history] = await Promise.all([
      this.operationalWork(ctx, scope, snapshot.production),
      this.destinationsView(scope, snapshot),
      this.history(scope, snapshot.contentItem.id),
    ]);
    const { contentItem, selection, approval, production } = snapshot;
    return {
      contentItem: {
        id: contentItem.id,
        title: contentItem.title,
        planningStatus: contentItem.planningStatus,
        plannedDate: contentItem.plannedDate,
        creativeFormat: contentItem.creativeFormat,
        archived: Boolean(contentItem.archivedAt),
      },
      selectedCreative: selection
        ? {
            assetId: selection.asset.id,
            assetName: selection.asset.name,
            mediaType: selection.asset.assetType,
            versionId: selection.version.id,
            versionNumber: selection.version.versionNumber,
            isAssetCurrentVersion:
              selection.asset.currentVersionId === selection.version.id,
            available: selection.unavailableReason === null,
            unavailableReason: selection.unavailableReason,
            selectedAt: production?.selectedAt?.toISOString() ?? null,
            selectedById: production?.selectedById ?? null,
            contentPath: `/social/creative-studio/assets/${selection.asset.id}/content?versionId=${selection.version.id}`,
            thumbnailPath: selection.version.thumbnailMediaAssetId
              ? `/social/creative-studio/assets/${selection.asset.id}/thumbnail?versionId=${selection.version.id}`
              : null,
          }
        : null,
      approval: {
        required: approval.required,
        state: approval.state,
        approvalId: approval.projection?.approvalId ?? null,
        status: approval.projection?.status ?? null,
        currentStage: approval.projection?.currentStage ?? null,
        sentToClientAt:
          approval.projection?.sentToClientAt?.toISOString() ?? null,
        approvedAt: approval.projection?.approvedAt?.toISOString() ?? null,
      },
      operationalWork,
      destinations,
      campaigns: {
        directAttachAvailable: false,
        path: 'destination_publication_boost',
      },
      readiness: snapshot.readiness,
      history,
      availableActions: await this.availableActions(
        ctx,
        snapshot,
        operationalWork,
        destinations.length,
      ),
    };
  }

  // ── Selection ───────────────────────────────────────────────────────────

  /**
   * Explicitly selects one immutable version as the item's deliverable.
   *
   * Never sends it to approval, never touches destinations or publications,
   * never deletes the previous selection's history. A replay of the current
   * selection is a no-op (no event, no write). Two concurrent selections
   * serialize on the production row: the last committed one wins.
   */
  async selectVersion(
    ctx: RequestContext,
    scope: CreativeStudioScope,
    contentItemId: string,
    versionId: string,
  ) {
    const item = await this.readiness.requireContentItem(scope, contentItemId);
    this.assertNotArchived(item);
    const version = await this.versions.findOne({ where: { id: versionId } });
    // A version id alone never authorizes: its asset must be in this scope.
    const asset =
      version &&
      (await this.assets.findOne({
        where: { ...this.scopeWhere(scope), id: version.creativeAssetId },
      }));
    if (!version || !asset)
      throw new NotFoundException('Versão não encontrada.');
    if (asset.status === 'archived' || asset.archivedAt)
      throw this.conflict(
        'creative_archived',
        'Criativo arquivado: escolha uma versão de um criativo ativo.',
      );
    if (asset.contentItemId && asset.contentItemId !== item.id)
      throw this.conflict(
        'creative_linked_to_other_content',
        'Este criativo foi produzido para outro conteúdo.',
      );
    if (!(await this.media.exists({ where: { id: version.mediaAssetId } })))
      throw this.conflict(
        'selected_version_unavailable',
        'O arquivo desta versão não está mais disponível.',
      );

    const actor = ctx.userId ?? null;
    const changed = await this.guarded(() =>
      this.dataSource.transaction(async (manager) => {
        const production = await this.lockProduction(manager, scope, item.id);
        if (production.selectedVersionId === version.id) return false;
        await manager.getRepository(CreativeProductionEntity).update(
          { id: production.id },
          {
            selectedCreativeAssetId: asset.id,
            selectedVersionId: version.id,
            selectedById: actor,
            selectedAt: new Date(),
          },
        );
        await this.readiness.recordEvent(
          manager,
          scope,
          item.id,
          'social.creative.version.selected',
          version.id,
          actor,
          {
            creativeAssetId: asset.id,
            versionNumber: version.versionNumber,
            previousVersionId: production.selectedVersionId,
          },
        );
        return true;
      }),
    );
    if (changed) await this.readiness.reflectPlanner(scope, item.id, actor);
    return { changed, production: await this.view(ctx, scope, item.id) };
  }

  /**
   * Clears the selection. History and every operational link already made
   * (approvals, destination creatives, publications) stay exactly as they are.
   * The Planner is not walked back: with nothing selected the Studio claims
   * nothing.
   */
  async clearSelection(
    ctx: RequestContext,
    scope: CreativeStudioScope,
    contentItemId: string,
  ) {
    const item = await this.readiness.requireContentItem(scope, contentItemId);
    this.assertNotArchived(item);
    const actor = ctx.userId ?? null;
    const changed = await this.dataSource.transaction(async (manager) => {
      const production = await this.lockProduction(manager, scope, item.id);
      if (!production.selectedVersionId) return false;
      await manager.getRepository(CreativeProductionEntity).update(
        { id: production.id },
        {
          selectedCreativeAssetId: null,
          selectedVersionId: null,
          selectedById: null,
          selectedAt: null,
        },
      );
      await this.readiness.recordEvent(
        manager,
        scope,
        item.id,
        'social.creative.selection.cleared',
        production.selectedVersionId,
        actor,
        { creativeAssetId: production.selectedCreativeAssetId },
      );
      return true;
    });
    return { changed, production: await this.view(ctx, scope, item.id) };
  }

  // ── Approval ────────────────────────────────────────────────────────────

  /**
   * Sends the SELECTED version (resolved here, never from the request) through
   * the existing Studio → Approvals entry point. Idempotent: an active request
   * of that exact version is returned instead of a second one, including when
   * two calls race (Approvals' advisory lock + active unique index decide, and
   * the loser re-reads).
   */
  async sendSelectedForApproval(
    ctx: RequestContext,
    scope: CreativeStudioScope,
    contentItemId: string,
  ) {
    const snapshot = await this.readiness.snapshot(scope, contentItemId);
    this.assertNotArchived(snapshot.contentItem);
    const selection = this.requireAvailableSelection(snapshot);
    if (!snapshot.approval.required)
      throw this.conflict(
        'approval_not_required',
        'Este contexto não usa aprovação: a versão selecionada já está pronta.',
      );
    if (snapshot.approval.state === 'changes_requested')
      throw this.conflict(
        'revision_required',
        'Foram solicitadas alterações nesta versão. Crie e selecione uma nova versão.',
      );
    if (
      snapshot.approval.state === 'pending' ||
      snapshot.approval.state === 'approved'
    )
      return {
        changed: false,
        approvalId: snapshot.approval.projection!.approvalId,
        production: await this.view(ctx, scope, contentItemId),
      };

    const actor = ctx.userId ?? null;
    let approvalId: string;
    try {
      const request = await this.versionApprovals.sendForApproval(
        scope,
        actor,
        selection.asset.id,
        selection.version.id,
      );
      approvalId = request.id;
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      const current = await this.readiness.snapshot(scope, contentItemId);
      if (
        current.selection?.version.id !== selection.version.id ||
        current.approval.state !== 'pending'
      )
        throw error;
      return {
        changed: false,
        approvalId: current.approval.projection!.approvalId,
        production: await this.view(ctx, scope, contentItemId),
      };
    }
    await this.readiness.recordEvent(
      this.events.manager,
      scope,
      snapshot.contentItem.id,
      'social.creative.sent_for_approval',
      selection.version.id,
      actor,
      { approvalId, creativeAssetId: selection.asset.id },
    );
    return {
      changed: true,
      approvalId,
      production: await this.view(ctx, scope, contentItemId),
    };
  }

  // ── Agency work ─────────────────────────────────────────────────────────

  /**
   * Links an EXISTING task (optionally one of its subtasks). The task is
   * resolved through the Agency's own visibility rules and must belong to the
   * same client as the current context; anything else is indistinguishable
   * from "not found". Replacing a link is explicit (same endpoint).
   */
  async linkTask(
    ctx: RequestContext,
    scope: CreativeStudioScope,
    contentItemId: string,
    input: LinkProductionTaskDto,
  ) {
    await this.assertPermission(ctx, P.taskUpdate);
    const item = await this.readiness.requireContentItem(scope, contentItemId);
    this.assertNotArchived(item);
    const task = await this.requireTaskInScope(ctx, scope, input.taskId);
    if (input.subtaskId) {
      const subtask = await this.subtasks.findOne({
        where: {
          id: input.subtaskId,
          taskId: task.id,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
        },
      });
      if (!subtask) throw new NotFoundException('Subtarefa não encontrada.');
    }
    const actor = ctx.userId ?? null;
    const changed = await this.dataSource.transaction(async (manager) => {
      const production = await this.lockProduction(manager, scope, item.id);
      if (
        production.taskId === task.id &&
        production.subtaskId === (input.subtaskId ?? null)
      )
        return false;
      await manager.getRepository(CreativeProductionEntity).update(
        { id: production.id },
        {
          taskId: task.id,
          subtaskId: input.subtaskId ?? null,
          projectId: task.projectId,
          taskLinkKind: 'linked',
          taskLinkedById: actor,
          taskLinkedAt: new Date(),
        },
      );
      await this.readiness.recordEvent(
        manager,
        scope,
        item.id,
        'social.creative.task.linked',
        production.selectedVersionId,
        actor,
        {
          taskId: task.id,
          subtaskId: input.subtaskId ?? null,
          projectId: task.projectId,
          previousTaskId: production.taskId,
        },
      );
      return true;
    });
    return { changed, production: await this.view(ctx, scope, item.id) };
  }

  /** Removes the link only; the task itself is the Agency's and is untouched. */
  async unlinkTask(
    ctx: RequestContext,
    scope: CreativeStudioScope,
    contentItemId: string,
  ) {
    const item = await this.readiness.requireContentItem(scope, contentItemId);
    this.assertNotArchived(item);
    const actor = ctx.userId ?? null;
    const changed = await this.dataSource.transaction(async (manager) => {
      const production = await this.lockProduction(manager, scope, item.id);
      if (!production.taskId) return false;
      await manager.getRepository(CreativeProductionEntity).update(
        { id: production.id },
        {
          taskId: null,
          subtaskId: null,
          projectId: null,
          taskLinkKind: null,
          taskLinkedById: null,
          taskLinkedAt: null,
        },
      );
      await this.readiness.recordEvent(
        manager,
        scope,
        item.id,
        'social.creative.task.unlinked',
        production.selectedVersionId,
        actor,
        { taskId: production.taskId, subtaskId: production.subtaskId },
      );
      return true;
    });
    return { changed, production: await this.view(ctx, scope, item.id) };
  }

  /**
   * Opt-in: creates ONE task through the Agency owner and links it. Retries
   * and concurrent calls return the task already linked (`changed: false`);
   * the production row lock is what makes "one task per item" hold. Due date
   * and assignee are exactly what the caller sent — no deadline math. The
   * description carries context and links, never the Planner copy.
   */
  async createTask(
    ctx: RequestContext,
    scope: CreativeStudioScope,
    contentItemId: string,
    input: CreateProductionTaskDto,
  ) {
    await this.assertPermission(ctx, P.taskCreate);
    const item = await this.readiness.requireContentItem(scope, contentItemId);
    this.assertNotArchived(item);
    if (input.projectId)
      await this.requireProjectInScope(scope, input.projectId);
    if (input.assigneeId) await this.requireAssignee(scope, input.assigneeId);
    const actor = this.requireActor(ctx);
    const taskContext = {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      userId: actor,
      role: ctx.role,
    };
    let createdTaskId: string | null = null;
    try {
      const outcome = await this.dataSource.transaction(async (manager) => {
        const production = await this.lockProduction(manager, scope, item.id);
        if (production.taskId)
          return { changed: false, taskId: production.taskId };
        const task = await this.taskOwner.createWorkspaceTask(taskContext, {
          title: (
            input.title?.trim() || `Produção criativa: ${item.title}`
          ).slice(0, 180),
          description: this.taskDescription(item),
          projectId: input.projectId ?? null,
          projectStageId: input.projectStageId,
          clientId: scope.agencyClientId,
          assigneeId: input.assigneeId ?? null,
          dueDate: input.dueDate ?? null,
          priority: input.priority,
          taskTypeId: input.taskTypeId ?? null,
        });
        createdTaskId = task.id;
        await manager.getRepository(CreativeProductionEntity).update(
          { id: production.id },
          {
            taskId: task.id,
            subtaskId: null,
            projectId: task.projectId,
            taskLinkKind: 'created',
            taskLinkedById: actor,
            taskLinkedAt: new Date(),
          },
        );
        await this.readiness.recordEvent(
          manager,
          scope,
          item.id,
          'social.creative.task.created',
          production.selectedVersionId,
          actor,
          { taskId: task.id, projectId: task.projectId },
        );
        return { changed: true, taskId: task.id };
      });
      return {
        ...outcome,
        production: await this.view(ctx, scope, item.id),
      };
    } catch (error) {
      // The task was created in the Agency's own transaction but the link did
      // not commit: archive it instead of leaving an orphan behind.
      if (createdTaskId)
        await this.taskOwner
          .archive(taskContext, createdTaskId)
          .catch(() => undefined);
      throw error;
    }
  }

  // ── Destination handoff ─────────────────────────────────────────────────

  /**
   * Hands the selected immutable version off to one destination of the item,
   * through the destination owner. Only when the item is creatively ready.
   * Never publishes or schedules; publication stays an explicit Publishing act.
   */
  async handoffToDestination(
    ctx: RequestContext,
    scope: CreativeStudioScope,
    contentItemId: string,
    destinationId: string,
    input: HandoffProductionDestinationDto,
  ) {
    const snapshot = await this.readiness.snapshot(scope, contentItemId);
    this.assertNotArchived(snapshot.contentItem);
    const selection = this.requireAvailableSelection(snapshot);
    if (snapshot.readiness.state !== 'ready')
      throw new ConflictException({
        code: 'creative_not_ready',
        message: 'A versão selecionada ainda não está pronta para os destinos.',
        blockers: snapshot.readiness.blockers,
      });
    const actor = ctx.userId ?? null;
    const result = await this.destinationOwner.handoffCreativeVersion(
      scope,
      destinationId,
      actor,
      {
        contentItemId: snapshot.contentItem.id,
        creativeVersionId: selection.version.id,
        mediaAssetId: selection.version.mediaAssetId,
        organicAssetId: input.organicAssetId,
        replaceExisting: input.replaceExisting === true,
      },
    );
    if (result.created)
      await this.readiness.recordEvent(
        this.events.manager,
        scope,
        snapshot.contentItem.id,
        'social.creative.destination.linked',
        selection.version.id,
        actor,
        {
          destinationId,
          destinationCreativeId: result.creative.id,
          organicAssetId: input.organicAssetId,
        },
      );
    return {
      changed: result.created,
      destinationCreative: result.creative,
      production: await this.view(ctx, scope, contentItemId),
    };
  }

  /**
   * Re-derives readiness from the owners and asks the Planner to reflect it.
   * The safety net for a missed approval transition, an archived asset or a
   * legacy row; idempotent.
   */
  async reconcile(
    ctx: RequestContext,
    scope: CreativeStudioScope,
    contentItemId: string,
  ) {
    const moved = await this.readiness.reflectPlanner(
      scope,
      contentItemId,
      ctx.userId ?? null,
    );
    return {
      changed: moved !== null,
      plannerTransition: moved,
      production: await this.view(ctx, scope, contentItemId),
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────

  /**
   * Creates the row on first use (ON CONFLICT DO NOTHING) and locks it, so
   * every command on one item serializes here.
   */
  private async lockProduction(
    manager: EntityManager,
    scope: CreativeStudioScope,
    contentItemId: string,
  ): Promise<CreativeProductionEntity> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(CreativeProductionEntity)
      .values({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        contentItemId,
      })
      .orIgnore()
      .execute();
    const production = await manager
      .getRepository(CreativeProductionEntity)
      .findOne({
        where: { ...this.scopeWhere(scope), contentItemId },
        lock: { mode: 'pessimistic_write' },
      });
    if (!production) throw new NotFoundException('Conteúdo não encontrado.');
    return production;
  }

  private async operationalWork(
    ctx: RequestContext,
    scope: CreativeStudioScope,
    production: CreativeProductionEntity | null,
  ): Promise<CreativeProductionView['operationalWork']> {
    const base = {
      linkKind: production?.taskLinkKind ?? null,
      taskId: production?.taskId ?? null,
      subtaskId: production?.subtaskId ?? null,
      projectId: production?.projectId ?? null,
      linkedAt: production?.taskLinkedAt?.toISOString() ?? null,
      linkedById: production?.taskLinkedById ?? null,
      task: null,
      subtask: null,
    };
    if (!production?.taskId) return { state: 'none', ...base };
    const task = await this.tasks.findOne({
      where: {
        id: production.taskId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
      },
    });
    // Deleted by its owner: the link is a dangling reference, shown as such.
    if (!task) return { state: 'missing', ...base };
    if (
      task.visibility === TaskVisibility.Private &&
      task.createdById !== ctx.userId
    )
      return { state: 'restricted', ...base };
    const subtask = production.subtaskId
      ? await this.subtasks.findOne({
          where: { id: production.subtaskId, taskId: task.id },
        })
      : null;
    return {
      ...base,
      state: task.archivedAt ? 'archived' : 'linked',
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        dueDate: task.dueDate?.toISOString() ?? null,
        assigneeId: task.assigneeId,
        completedAt: task.completedAt?.toISOString() ?? null,
      },
      subtask: subtask
        ? {
            id: subtask.id,
            title: subtask.title,
            status: subtask.status,
            isDone: subtask.isDone,
          }
        : null,
    };
  }

  private async destinationsView(
    scope: CreativeStudioScope,
    snapshot: CreativeProductionSnapshot,
  ): Promise<CreativeProductionView['destinations']> {
    const clientWhere = {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      contentItemId: snapshot.contentItem.id,
    };
    const [destinations, creatives] = await Promise.all([
      this.destinations.find({
        where: clientWhere,
        order: { createdAt: 'ASC' },
      }),
      this.destinationCreatives.find({
        where: clientWhere,
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      }),
    ]);
    const selectedVersionId = snapshot.selection?.version.id ?? null;
    return destinations.map((destination) => {
      const rows = creatives.filter(
        (creative) => creative.destinationId === destination.id,
      );
      return {
        destinationId: destination.id,
        channel: destination.channel,
        placement: destination.placement,
        plannedAt: destination.plannedAt?.toISOString() ?? null,
        handoff: this.handoffState(rows, selectedVersionId),
        creatives: rows.map((row) => ({
          id: row.id,
          role: row.role,
          sortOrder: row.sortOrder,
          source: row.source,
          creativeVersionId: row.creativeVersionId ?? null,
          organicAssetId: row.organicAssetId,
        })),
      };
    });
  }

  /**
   * `other_version` is the visible consequence of the version-safety rule: a
   * destination keeps the exact version it was handed, and a newer selection
   * reaches it only through an explicit new handoff.
   */
  private handoffState(
    rows: SocialDestinationCreativeEntity[],
    selectedVersionId: string | null,
  ): CreativeDestinationHandoff {
    if (rows.length === 0) return 'none';
    if (
      selectedVersionId &&
      rows.every((row) => row.creativeVersionId === selectedVersionId)
    )
      return 'selected_version';
    if (rows.some((row) => row.creativeVersionId)) return 'other_version';
    return 'manual';
  }

  private async history(
    scope: CreativeStudioScope,
    contentItemId: string,
  ): Promise<CreativeProductionView['history']> {
    const rows = await this.events.find({
      where: { ...this.scopeWhere(scope), contentItemId },
      order: { occurredAt: 'DESC' },
      take: HISTORY_LIMIT,
    });
    return rows.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      creativeVersionId: row.creativeVersionId,
      actorUserId: row.actorUserId,
      payload: row.payload,
      occurredAt: row.occurredAt.toISOString(),
    }));
  }

  /**
   * Permission- and state-aware actions, so the frontend does not re-implement
   * either. The first failing condition is the reason.
   */
  private async availableActions(
    ctx: RequestContext,
    snapshot: CreativeProductionSnapshot,
    work: CreativeProductionView['operationalWork'],
    destinationCount: number,
  ): Promise<CreativeProductionView['availableActions']> {
    const context = {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId ?? '',
      role: ctx.role ?? 'member',
    };
    const can = (key: string): Promise<boolean> =>
      ctx.userId ? this.permissions.can(context, key) : Promise.resolve(false);
    const [update, submit, plannerUpdate, taskCreate, taskUpdate] =
      await Promise.all(
        [
          P.update,
          P.submitReview,
          P.plannerUpdate,
          P.taskCreate,
          P.taskUpdate,
        ].map(can),
      );
    const live = !snapshot.contentItem.archivedAt;
    const selected = snapshot.selection !== null;
    const available =
      selected && snapshot.selection!.unavailableReason === null;
    const approval = snapshot.approval;
    const linked = work.taskId !== null;
    const act = (
      action: CreativeProductionAction,
      checks: Array<[boolean, string]>,
    ) => {
      const failed = checks.find(([ok]) => !ok);
      return { action, allowed: !failed, reason: failed?.[1] ?? null };
    };
    return [
      act('select_creative', [
        [update, 'forbidden'],
        [live, 'content_archived'],
      ]),
      act('clear_selection', [
        [update, 'forbidden'],
        [live, 'content_archived'],
        [selected, 'no_creative_selected'],
      ]),
      act('send_for_approval', [
        [submit, 'forbidden'],
        [live, 'content_archived'],
        [selected, 'no_creative_selected'],
        [available, 'selected_version_unavailable'],
        [approval.required, 'approval_not_required'],
        [approval.state !== 'pending', 'approval_pending'],
        [approval.state !== 'approved', 'already_approved'],
        [approval.state !== 'changes_requested', 'revision_required'],
      ]),
      act('create_task', [
        [update && taskCreate, 'forbidden'],
        [live, 'content_archived'],
        [!linked, 'task_already_linked'],
      ]),
      act('link_task', [
        [update && taskUpdate, 'forbidden'],
        [live, 'content_archived'],
      ]),
      act('unlink_task', [
        [update, 'forbidden'],
        [live, 'content_archived'],
        [linked, 'no_task_linked'],
      ]),
      act('handoff_to_publishing', [
        [plannerUpdate, 'forbidden'],
        [live, 'content_archived'],
        [snapshot.readiness.state === 'ready', 'creative_not_ready'],
        [destinationCount > 0, 'no_destinations'],
      ]),
      act('handoff_to_campaigns', [[false, 'campaigns_consume_publications']]),
      act('reconcile', [[update, 'forbidden']]),
    ];
  }

  private async requireTaskInScope(
    ctx: RequestContext,
    scope: CreativeStudioScope,
    taskId: string,
  ): Promise<AgencyTask> {
    const task = await this.tasks.findOne({
      where: {
        id: taskId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
      },
    });
    const hidden =
      !task ||
      task.archivedAt !== null ||
      (task.visibility === TaskVisibility.Private &&
        task.createdById !== ctx.userId);
    // Tasks are client-scoped (no Company Context in the Agency model). The
    // effective client is the task's own, else its project's.
    const clientId = hidden
      ? undefined
      : (task.clientId ??
        (task.projectId
          ? ((
              await this.projects.findOne({
                where: {
                  id: task.projectId,
                  tenantId: scope.tenantId,
                  workspaceId: scope.workspaceId,
                },
                select: { id: true, clientId: true },
              })
            )?.clientId ?? null)
          : null));
    if (hidden || clientId !== scope.agencyClientId)
      throw new NotFoundException('Tarefa não encontrada.');
    return task;
  }

  private async requireProjectInScope(
    scope: CreativeStudioScope,
    projectId: string,
  ): Promise<void> {
    const project = await this.projects.findOne({
      where: {
        id: projectId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
      },
      select: { id: true, clientId: true },
    });
    if (!project || project.clientId !== scope.agencyClientId)
      throw new NotFoundException('Projeto não encontrado.');
  }

  /** Only an active team member of this workspace can be assigned. */
  private async requireAssignee(
    scope: CreativeStudioScope,
    assigneeId: string,
  ): Promise<void> {
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM team_members
        WHERE tenant_id = $1 AND workspace_id = $2
          AND (id = $3 OR user_id = $3) AND archived_at IS NULL
        LIMIT 1`,
      [scope.tenantId, scope.workspaceId, assigneeId],
    );
    if (rows.length === 0)
      throw new BadRequestException({
        code: 'assignee_not_found',
        message: 'Responsável não encontrado neste workspace.',
      });
  }

  private taskDescription(item: {
    id: string;
    title: string;
    plannedDate: string | null;
    creativeFormat: string | null;
  }): string {
    return [
      `Produção criativa do conteúdo "${item.title}".`,
      item.plannedDate ? `Data planejada: ${item.plannedDate}.` : null,
      item.creativeFormat ? `Formato: ${item.creativeFormat}.` : null,
      `Planner: /social/planner/content/${item.id}`,
      `Creative Studio: /social/creative-studio?contentItemId=${item.id}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private requireAvailableSelection(snapshot: CreativeProductionSnapshot) {
    if (!snapshot.selection)
      throw this.conflict(
        'no_creative_selected',
        'Selecione a versão final do criativo primeiro.',
      );
    if (snapshot.selection.unavailableReason)
      throw this.conflict(
        'selected_version_unavailable',
        'A versão selecionada não está mais disponível.',
      );
    return snapshot.selection;
  }

  private assertNotArchived(item: { archivedAt: Date | null }) {
    if (item.archivedAt)
      throw this.conflict(
        'content_archived',
        'Conteúdo arquivado: restaure-o antes de alterar a produção.',
      );
  }

  private async assertPermission(ctx: RequestContext, key: string) {
    await this.permissions.assertCan(
      {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        userId: this.requireActor(ctx),
        role: ctx.role ?? 'member',
      },
      key,
    );
  }

  private requireActor(ctx: RequestContext): string {
    if (!ctx.userId)
      throw new BadRequestException(
        'Usuário autenticado é obrigatório para esta ação.',
      );
    return ctx.userId;
  }

  /** Translates the database guards into the same answers the service gives. */
  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      switch (databaseConstraint(error)) {
        case 'TR_social_creative_productions_archived':
          throw this.conflict(
            'creative_archived',
            'Criativo arquivado: escolha uma versão de um criativo ativo.',
          );
        case 'TR_social_creative_productions_content':
          throw this.conflict(
            'creative_linked_to_other_content',
            'Este criativo foi produzido para outro conteúdo.',
          );
        case 'TR_social_creative_productions_scope':
        case 'TR_social_creative_productions_version':
          throw new NotFoundException('Versão não encontrada.');
        default:
          throw error;
      }
    }
  }

  private conflict(code: string, message: string) {
    return new ConflictException({ code, message });
  }

  private scopeWhere(scope: CreativeStudioScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      companyContextId:
        scope.companyContextId === null ? IsNull() : scope.companyContextId,
    };
  }
}
