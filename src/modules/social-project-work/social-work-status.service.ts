import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager, In, IsNull, Not } from 'typeorm';
import { AgencyTask, AgencyTaskChecklistItem, TaskStatus } from '../projects';
import { TasksCrudService } from '../projects/services/tasks-crud.service';
import { TaskWorkspaceService } from '../projects/services/task-workspace.service';
import { SocialApprovalTransitionRegistry } from '../social-approvals/approval-transition.port';
import {
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStepEntity,
} from '../social-approvals/entities';
import { SocialContentWorkLinkEntity } from './entities';
import {
  deriveParentTaskStatus,
  deriveSubtaskStatus,
  type WorkSignal,
} from './work-status.derivation';

/** Decisions a person (or a removal) made that a later round never undoes. */
const SETTLED_SUBTASK = new Set(['cancelled', 'done']);
const SETTLED_TASK = new Set<TaskStatus>([
  TaskStatus.Cancelled,
  TaskStatus.Done,
  TaskStatus.Archived,
]);

/**
 * D-26 — approvals move tasks and subtasks, never the other way around.
 *
 * Runs after the decision committed and always re-reads the owners, so a
 * repeated or missed call converges on the same state and `syncTask` is also
 * the reconciliation. Writes go through the Projects services, so time
 * tracking and the project timeline behave as for any other status change.
 */
@Injectable()
export class SocialWorkStatusService implements OnModuleInit {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly tasks: TasksCrudService,
    private readonly checklist: TaskWorkspaceService,
    private readonly transitions: SocialApprovalTransitionRegistry,
  ) {}

  onModuleInit(): void {
    this.transitions.register((request) => this.onTransition(request));
    this.transitions.registerPieceFinished((piece) =>
      this.onPieceFinished(piece),
    );
  }

  private async onTransition(
    request: SocialApprovalRequestEntity,
  ): Promise<void> {
    if (!request.stepId) return;
    const manager = this.dataSource.manager;
    const step = await manager
      .getRepository(SocialApprovalStepEntity)
      .findOne({ where: { id: request.stepId } });
    const piece =
      step &&
      (await manager
        .getRepository(SocialApprovalPieceEntity)
        .findOne({ where: { id: step.pieceId } }));
    if (!step || !piece) return;
    await this.syncAll(piece, await this.taskIdsOf(manager, piece, [step]));
  }

  private async onPieceFinished(
    piece: SocialApprovalPieceEntity,
  ): Promise<void> {
    const manager = this.dataSource.manager;
    const steps = await manager
      .getRepository(SocialApprovalStepEntity)
      .find({ where: { pieceId: piece.id } });
    await this.syncAll(piece, await this.taskIdsOf(manager, piece, steps));
  }

  private async syncAll(
    piece: SocialApprovalPieceEntity,
    taskIds: readonly string[],
  ): Promise<void> {
    for (const taskId of taskIds)
      await this.syncTask(piece.tenantId, piece.workspaceId, taskId);
  }

  private async taskIdsOf(
    manager: EntityManager,
    piece: SocialApprovalPieceEntity,
    steps: readonly SocialApprovalStepEntity[],
  ): Promise<string[]> {
    if (piece.kind === 'standalone')
      return [
        ...new Set(
          steps
            .map((step) => step.workTaskId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
    if (piece.kind !== 'content_item' || !piece.sourceId) return [];
    const links = await manager
      .getRepository(SocialContentWorkLinkEntity)
      .find({
        where: {
          tenantId: piece.tenantId,
          workspaceId: piece.workspaceId,
          contentItemId: piece.sourceId,
        },
      });
    return [...new Set(links.map((link) => link.taskId))];
  }

  /**
   * Serialized per task: two decisions landing together must not evaluate the
   * parent from a half-applied picture, and the last one in sees both.
   */
  async syncTask(
    tenantId: string,
    workspaceId: string,
    taskId: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (lock) => {
      await lock.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `social_work_task:${taskId}`,
      ]);
      return this.applyTask(tenantId, workspaceId, taskId);
    });
  }

  private async applyTask(
    tenantId: string,
    workspaceId: string,
    taskId: string,
  ): Promise<boolean> {
    const manager = this.dataSource.manager;
    const task = await manager
      .getRepository(AgencyTask)
      .findOne({ where: { id: taskId, tenantId, workspaceId } });
    if (!task || task.archivedAt) return false;
    const signals = await this.signalsBySubtask(
      manager,
      tenantId,
      workspaceId,
      taskId,
    );
    if (signals.size === 0) return false;

    const subtasks = await manager
      .getRepository(AgencyTaskChecklistItem)
      .find({ where: { tenantId, workspaceId, taskId } });
    // The author always reaches their own task, even one made private later.
    const context = {
      tenantId,
      workspaceId,
      userId: task.createdById,
      role: 'owner',
    };
    const statuses = new Map(subtasks.map((row) => [row.id, row.status]));
    let changed = false;
    let finalized = false;
    for (const [subtaskId, list] of signals) {
      const target = deriveSubtaskStatus(list);
      if (target === 'done') finalized = true;
      const current = statuses.get(subtaskId);
      if (
        !target ||
        current === undefined ||
        current === target ||
        SETTLED_SUBTASK.has(current)
      )
        continue;
      await this.checklist.updateChecklistItem(context, taskId, subtaskId, {
        status: target,
      });
      statuses.set(subtaskId, target);
      changed = true;
    }

    if (SETTLED_TASK.has(task.status)) return changed;
    const next = deriveParentTaskStatus(
      [...statuses.values()],
      task.status,
      finalized,
    );
    if (!next || next === task.status) return changed;
    await this.tasks.update(context, taskId, { status: next });
    return true;
  }

  private async signalsBySubtask(
    manager: EntityManager,
    tenantId: string,
    workspaceId: string,
    taskId: string,
  ): Promise<Map<string, WorkSignal[]>> {
    const signals = new Map<string, WorkSignal[]>();
    const push = (subtaskId: string, signal: WorkSignal) =>
      signals.set(subtaskId, [...(signals.get(subtaskId) ?? []), signal]);

    const steps = manager.getRepository(SocialApprovalStepEntity);
    const links = await manager
      .getRepository(SocialContentWorkLinkEntity)
      .find({
        where: { tenantId, workspaceId, taskId, cancelledAt: IsNull() },
      });
    const pieces = links.length
      ? await manager.getRepository(SocialApprovalPieceEntity).find({
          where: {
            tenantId,
            workspaceId,
            kind: 'content_item',
            sourceId: In(links.map((link) => link.contentItemId)),
          },
        })
      : [];
    const itemSteps = pieces.length
      ? await steps.find({
          where: {
            pieceId: In(pieces.map((piece) => piece.id)),
            kind: In(['copy', 'creative']),
          },
        })
      : [];
    const standaloneSteps = await steps.find({
      where: {
        tenantId,
        workspaceId,
        workTaskId: taskId,
        workSubtaskId: Not(IsNull()),
      },
    });
    const standalonePieces = standaloneSteps.length
      ? await manager.getRepository(SocialApprovalPieceEntity).find({
          where: { id: In(standaloneSteps.map((step) => step.pieceId)) },
        })
      : [];
    const requestIds = [...itemSteps, ...standaloneSteps]
      .map((step) => step.currentRequestId)
      .filter((id): id is string => Boolean(id));
    const requests = requestIds.length
      ? await manager
          .getRepository(SocialApprovalRequestEntity)
          .find({ where: { id: In(requestIds) } })
      : [];
    const requestById = new Map(requests.map((row) => [row.id, row]));
    const signalOf = (
      step: SocialApprovalStepEntity | undefined,
      piece: SocialApprovalPieceEntity | undefined,
    ): WorkSignal => ({
      status:
        (step?.currentRequestId &&
          requestById.get(step.currentRequestId)?.status) ||
        null,
      isStale: step?.isStale ?? false,
      finished: Boolean(piece?.finishedAt),
    });

    for (const link of links) {
      if (!link.subtaskId) continue;
      const piece = pieces.find((row) => row.sourceId === link.contentItemId);
      const kinds =
        link.stepKind === 'item'
          ? (['copy', 'creative'] as const)
          : ([link.stepKind] as const);
      for (const kind of kinds)
        push(
          link.subtaskId,
          signalOf(
            piece &&
              itemSteps.find(
                (row) => row.pieceId === piece.id && row.kind === kind,
              ),
            piece,
          ),
        );
    }
    for (const step of standaloneSteps)
      push(
        step.workSubtaskId!,
        signalOf(
          step,
          standalonePieces.find((row) => row.id === step.pieceId),
        ),
      );
    return signals;
  }
}
