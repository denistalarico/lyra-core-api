import { createHash, randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import type { LeadFlowAutomationRecipeCatalogItem } from '../catalog/automation-recipes.catalog';
import {
  LeadFlowAutomationRunAttemptEntity,
  LeadFlowAutomationRunEntity,
  LeadFlowAutomationVersionEntity,
} from '../entities';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import {
  LeadFlowAutomationAttemptStatus,
  LeadFlowAutomationErrorClass,
  LeadFlowAutomationRunMode,
  LeadFlowAutomationRunStatus,
} from '../enums/leadflow-automation-run.enums';
import type { LeadFlowJsonObject } from '../types/leadflow-automation.types';
import type { LeadFlowAutomationContextSnapshot } from '../types/leadflow-automation-context.types';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities/leadflow-event-delivery.entity';
import type {
  AutomationEffectResult,
  AutomationExecutorAvailability,
} from '../executors';
import type { LeadFlowAutomationEvaluation } from './leadflow-automation-evaluation.service';

const AGENCY_CONNECTION = 'agency';

/** One action actually requested from its owning domain during a live run. */
export interface LeadFlowAutomationLiveEffect {
  actionKey: string;
  result: AutomationEffectResult;
  durationMs: number;
}

/** Maps an effect status onto the attempt status recorded for it. */
function attemptStatusFor(
  status: AutomationEffectResult['status'],
): LeadFlowAutomationAttemptStatus {
  switch (status) {
    case 'confirmed':
      return LeadFlowAutomationAttemptStatus.Succeeded;
    case 'failed':
      return LeadFlowAutomationAttemptStatus.Failed;
    // A governed refusal, or an unavailable executor that slipped through, did
    // not succeed and is not a fault: it deliberately did nothing.
    default:
      return LeadFlowAutomationAttemptStatus.Skipped;
  }
}

/** Runs are history, not a feed — a page is enough for the detail view. */
const DEFAULT_RUN_LIMIT = 25;
const MAX_RUN_LIMIT = 100;

export interface LeadFlowAutomationRunWithAttempts {
  run: LeadFlowAutomationRunEntity;
  attempts: LeadFlowAutomationRunAttemptEntity[];
}

type LeadFlowAutomationRunRecipe = Pick<
  LeadFlowAutomationRecipeCatalogItem,
  'trigger' | 'triggerKind'
>;

/**
 * Persists and reads automation runs.
 *
 * Every write goes through here so the tenant/workspace scope is applied in one
 * place. Reads are always scoped by the caller's context — a run belonging to
 * another workspace is not found, not filtered out later.
 */
@Injectable()
export class LeadFlowAutomationRunService {
  constructor(
    @InjectRepository(LeadFlowAutomationRunEntity, AGENCY_CONNECTION)
    private readonly runsRepository: Repository<LeadFlowAutomationRunEntity>,
    @InjectRepository(LeadFlowAutomationRunAttemptEntity, AGENCY_CONNECTION)
    private readonly attemptsRepository: Repository<LeadFlowAutomationRunAttemptEntity>,
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Records a completed dry-run.
   *
   * The run is written already finished because a simulation is synchronous and
   * cannot fail partway — there is nothing to resume. Its attempts are stored
   * with status `simulated`, which is what keeps them from ever being counted
   * as delivered effects.
   */
  async recordDryRun(
    ctx: RequestContext,
    automation: LeadFlowAutomationEntity,
    recipe: LeadFlowAutomationRunRecipe | undefined,
    evaluation: LeadFlowAutomationEvaluation,
    extras: {
      blockedByDependency: boolean;
      contextSnapshot?: LeadFlowAutomationContextSnapshot;
    } = { blockedByDependency: false },
  ): Promise<LeadFlowAutomationRunWithAttempts> {
    const now = new Date();
    const correlationId = randomUUID();

    const run = await this.runsRepository.save(
      this.runsRepository.create({
        tenantId: automation.tenantId,
        workspaceId: automation.workspaceId,
        automationId: automation.id,
        automationVersionId: automation.publishedVersionId,
        recipeKey: automation.recipeKey,
        templateVersion: automation.templateVersion ?? 1,
        mode: LeadFlowAutomationRunMode.DryRun,
        status: evaluation.status,
        skipReason: evaluation.skipReason,
        triggerType:
          (automation.triggerConfig?.type as string) ??
          recipe?.trigger ??
          'unknown',
        triggerKind: recipe?.triggerKind ?? 'derived',
        sourceEventId: null,
        sourceEventName: null,
        correlationId,
        causationId: null,
        // Dry-runs are explicitly repeatable, so they carry no idempotency key:
        // an operator may simulate the same situation as often as they like.
        idempotencyKey: null,
        inputSnapshot: {
          context: evaluation.context as unknown as LeadFlowJsonObject,
          contextSnapshot:
            (extras.contextSnapshot as unknown as LeadFlowJsonObject) ?? null,
          blockedByDependency: extras.blockedByDependency,
        },
        result: {
          wouldAct: evaluation.wouldAct,
          checks: evaluation.checks as unknown as LeadFlowJsonObject[],
          plannedActions: evaluation.plannedActions,
          blockedByDependency: extras.blockedByDependency,
          contextGaps: evaluation.gaps as unknown as LeadFlowJsonObject[],
        } as unknown as LeadFlowJsonObject,
        errorCode: null,
        errorMessage: null,
        attemptCount: evaluation.plannedActions.length,
        scheduledAt: null,
        startedAt: now,
        finishedAt: now,
        createdById: ctx.userId ?? null,
      }),
    );

    const attempts = await this.attemptsRepository.save(
      evaluation.plannedActions.map((actionKey, index) =>
        this.attemptsRepository.create({
          tenantId: automation.tenantId,
          workspaceId: automation.workspaceId,
          runId: run.id,
          attemptNumber: index + 1,
          actionKey,
          status: LeadFlowAutomationAttemptStatus.Simulated,
          errorClass: null,
          errorCode: null,
          errorMessage: null,
          effectRequested: { action: actionKey, simulated: true },
          // Never true for a simulation. This is the flag a future retry would
          // consult before replaying an effect.
          effectConfirmed: false,
          durationMs: 0,
          startedAt: now,
          finishedAt: now,
        }),
      ),
    );

    return { run, attempts };
  }

  /**
   * Records the evaluation of a real delivered trigger that carried out nothing.
   *
   * Idempotent on the delivery/automation pair: a redelivered event re-enters
   * the ingress, and without this key the same trigger would accumulate a new
   * run on every retry. The first persisted run pins the version that was
   * published when processing began; a republish during retry cannot reinterpret
   * the old event under a newer configuration.
   */
  async recordShadowRun(
    automation: LeadFlowAutomationEntity,
    version: LeadFlowAutomationVersionEntity,
    recipe: LeadFlowAutomationRunRecipe | undefined,
    evaluation: LeadFlowAutomationEvaluation,
    extras: {
      delivery: LeadFlowEventDeliveryEntity;
      contextSnapshot: LeadFlowAutomationContextSnapshot;
      unavailableActions: AutomationExecutorAvailability[];
    },
  ): Promise<LeadFlowAutomationRunWithAttempts> {
    const { delivery, contextSnapshot, unavailableActions } = extras;
    const digest = createHash('sha256')
      .update(
        [
          delivery.tenantId,
          delivery.workspaceId,
          delivery.sourceEventId,
          automation.id,
        ].join(':'),
      )
      .digest('hex');
    const idempotencyKey = `shadow:${digest}`;

    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [idempotencyKey],
      );
      const runs = manager.getRepository(LeadFlowAutomationRunEntity);
      const attemptsRepository = manager.getRepository(
        LeadFlowAutomationRunAttemptEntity,
      );
      const existing = await runs.findOne({
        where: {
          tenantId: automation.tenantId,
          workspaceId: automation.workspaceId,
          idempotencyKey,
        },
      });
      if (existing) {
        const attempts = await attemptsRepository.find({
          where: {
            runId: existing.id,
            tenantId: automation.tenantId,
            workspaceId: automation.workspaceId,
          },
          order: { attemptNumber: 'ASC' },
        });
        return { run: existing, attempts };
      }

      const now = new Date();
      // A verdict built partly on assumed signals is weaker than one built on
      // observed state; the distinction is recorded rather than smoothed over.
      const fullyObserved = isFullyObserved(contextSnapshot);
      const correlationId = uuidFrom(delivery.payload.correlationId)
        ? String(delivery.payload.correlationId)
        : delivery.sourceEventId;
      const causationId = uuidFrom(delivery.payload.causationId)
        ? String(delivery.payload.causationId)
        : null;

      const run = await runs.save(
        runs.create({
          tenantId: automation.tenantId,
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          automationVersionId: version.id,
          recipeKey: automation.recipeKey,
          templateVersion: automation.templateVersion ?? 1,
          mode: LeadFlowAutomationRunMode.Shadow,
          status: evaluation.status,
          skipReason: evaluation.skipReason,
          triggerType:
            (automation.triggerConfig?.type as string) ??
            recipe?.trigger ??
            'unknown',
          triggerKind: recipe?.triggerKind ?? 'event',
          sourceEventId: delivery.sourceEventId,
          sourceEventName: delivery.eventName,
          correlationId,
          causationId,
          idempotencyKey,
          inputSnapshot: {
            context: evaluation.context as unknown as LeadFlowJsonObject,
            // Immutable record of what the verdict was computed from. Versioned
            // so a stored decision is always re-readable under the rules that
            // produced it.
            contextSnapshot: contextSnapshot as unknown as LeadFlowJsonObject,
            verdictBasis: fullyObserved ? 'observed' : 'partially_assumed',
            deliveryId: delivery.id,
            occurredAt: delivery.occurredAt.toISOString(),
            publishedVersionNumber: version.version,
          },
          result: {
            wouldAct: evaluation.wouldAct,
            eligibleForExecution:
              evaluation.wouldAct && unavailableActions.length === 0,
            checks: evaluation.checks as unknown as LeadFlowJsonObject[],
            plannedActions: evaluation.plannedActions,
            unavailableActions:
              unavailableActions as unknown as LeadFlowJsonObject[],
            blockedByExecutor: unavailableActions.length > 0,
            contextGaps:
              contextSnapshot.gaps as unknown as LeadFlowJsonObject[],
            contextCost: contextSnapshot.cost as unknown as LeadFlowJsonObject,
            executedAnything: false,
          } as unknown as LeadFlowJsonObject,
          errorCode: null,
          errorMessage: null,
          attemptCount: evaluation.plannedActions.length,
          scheduledAt: null,
          startedAt: now,
          finishedAt: now,
          createdById: null,
        }),
      );

      const blockedByAction = new Map(
        unavailableActions.map((item) => [item.actionKey, item]),
      );

      const attempts = await attemptsRepository.save(
        evaluation.plannedActions.map((actionKey, index) => {
          const blocked = blockedByAction.get(actionKey);
          return attemptsRepository.create({
            tenantId: automation.tenantId,
            workspaceId: automation.workspaceId,
            runId: run.id,
            attemptNumber: index + 1,
            actionKey,
            status: LeadFlowAutomationAttemptStatus.Simulated,
            errorClass: blocked ? LeadFlowAutomationErrorClass.Permanent : null,
            errorCode: blocked
              ? blocked.reason === 'dependency_missing'
                ? 'executor_dependency_missing'
                : 'executor_not_implemented'
              : null,
            errorMessage: blocked ? blocked.description : null,
            effectRequested: {
              action: actionKey,
              shadow: true,
              automationVersionId: version.id,
            },
            // Never true in shadow mode: nothing was asked of any domain.
            effectConfirmed: false,
            durationMs: 0,
            startedAt: now,
            finishedAt: now,
          });
        }),
      );

      return { run, attempts };
    });
  }

  /**
   * Records a live run: a real delivered trigger whose planned actions were
   * actually requested from their owning domains.
   *
   * Distinguished from a shadow run only by mode and by the attempts carrying
   * real effect results — `effectConfirmed` is true only where a domain
   * acknowledged the effect. Idempotent on the delivery/automation pair under a
   * `live:` key, so a redelivery of the same event does not re-execute: the
   * per-effect idempotency in the executor is the second line, this is the
   * first.
   */
  async recordLiveRun(
    automation: LeadFlowAutomationEntity,
    version: LeadFlowAutomationVersionEntity,
    recipe: LeadFlowAutomationRunRecipe | undefined,
    evaluation: LeadFlowAutomationEvaluation,
    extras: {
      delivery: LeadFlowEventDeliveryEntity;
      contextSnapshot: LeadFlowAutomationContextSnapshot;
      effects: LeadFlowAutomationLiveEffect[];
    },
  ): Promise<LeadFlowAutomationRunWithAttempts> {
    const { delivery, contextSnapshot, effects } = extras;
    const digest = createHash('sha256')
      .update(
        [
          delivery.tenantId,
          delivery.workspaceId,
          delivery.sourceEventId,
          automation.id,
        ].join(':'),
      )
      .digest('hex');
    const idempotencyKey = `live:${digest}`;

    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [idempotencyKey],
      );
      const runs = manager.getRepository(LeadFlowAutomationRunEntity);
      const attemptsRepository = manager.getRepository(
        LeadFlowAutomationRunAttemptEntity,
      );
      const existing = await runs.findOne({
        where: {
          tenantId: automation.tenantId,
          workspaceId: automation.workspaceId,
          idempotencyKey,
        },
      });
      if (existing) {
        const attempts = await attemptsRepository.find({
          where: {
            runId: existing.id,
            tenantId: automation.tenantId,
            workspaceId: automation.workspaceId,
          },
          order: { attemptNumber: 'ASC' },
        });
        return { run: existing, attempts };
      }

      const now = new Date();
      const anyConfirmed = effects.some(
        (effect) => effect.result.effectConfirmed,
      );
      const anyFailed = effects.some(
        (effect) => effect.result.status === 'failed',
      );
      // A run that broke is failed; one where every effect landed is a success;
      // one that was governed-refused did nothing wrong but did nothing either.
      const status = anyFailed
        ? LeadFlowAutomationRunStatus.Failed
        : anyConfirmed
          ? LeadFlowAutomationRunStatus.Succeeded
          : LeadFlowAutomationRunStatus.Skipped;
      const firstError = effects.find((effect) => effect.result.errorCode);
      const correlationId = uuidFrom(delivery.payload.correlationId)
        ? String(delivery.payload.correlationId)
        : delivery.sourceEventId;

      const run = await runs.save(
        runs.create({
          tenantId: automation.tenantId,
          workspaceId: automation.workspaceId,
          automationId: automation.id,
          automationVersionId: version.id,
          recipeKey: automation.recipeKey,
          templateVersion: automation.templateVersion ?? 1,
          mode: LeadFlowAutomationRunMode.Live,
          status,
          skipReason: null,
          triggerType:
            (automation.triggerConfig?.type as string) ??
            recipe?.trigger ??
            'unknown',
          triggerKind: recipe?.triggerKind ?? 'event',
          sourceEventId: delivery.sourceEventId,
          sourceEventName: delivery.eventName,
          correlationId,
          causationId: uuidFrom(delivery.payload.causationId)
            ? String(delivery.payload.causationId)
            : null,
          idempotencyKey,
          inputSnapshot: {
            context: evaluation.context as unknown as LeadFlowJsonObject,
            contextSnapshot: contextSnapshot as unknown as LeadFlowJsonObject,
            verdictBasis: isFullyObserved(contextSnapshot)
              ? 'observed'
              : 'partially_assumed',
            deliveryId: delivery.id,
            occurredAt: delivery.occurredAt.toISOString(),
            publishedVersionNumber: version.version,
          },
          result: {
            wouldAct: evaluation.wouldAct,
            plannedActions: evaluation.plannedActions,
            executedAnything: anyConfirmed,
            confirmedCount: effects.filter(
              (effect) => effect.result.effectConfirmed,
            ).length,
            refusedCount: effects.filter(
              (effect) => effect.result.status === 'refused',
            ).length,
            failedCount: effects.filter(
              (effect) => effect.result.status === 'failed',
            ).length,
            contextCost: contextSnapshot.cost as unknown as LeadFlowJsonObject,
            effects: effects.map((effect) => ({
              actionKey: effect.actionKey,
              status: effect.result.status,
              effectConfirmed: effect.result.effectConfirmed,
              details: effect.result.details ?? {},
            })),
          } as unknown as LeadFlowJsonObject,
          errorCode: firstError?.result.errorCode ?? null,
          errorMessage: firstError?.result.errorMessage ?? null,
          attemptCount: effects.length,
          scheduledAt: null,
          startedAt: now,
          finishedAt: now,
          createdById: null,
        }),
      );

      const attempts = await attemptsRepository.save(
        effects.map((effect, index) =>
          attemptsRepository.create({
            tenantId: automation.tenantId,
            workspaceId: automation.workspaceId,
            runId: run.id,
            attemptNumber: index + 1,
            actionKey: effect.actionKey,
            status: attemptStatusFor(effect.result.status),
            errorClass: effect.result.errorClass ?? null,
            errorCode: effect.result.errorCode ?? null,
            errorMessage: effect.result.errorMessage ?? null,
            effectRequested: {
              action: effect.actionKey,
              live: true,
              automationVersionId: version.id,
              resultDetails: effect.result.details ?? {},
            },
            // True only where the owning domain acknowledged the effect.
            effectConfirmed: effect.result.effectConfirmed,
            durationMs: effect.durationMs,
            startedAt: now,
            finishedAt: now,
          }),
        ),
      );

      return { run, attempts };
    });
  }

  async listRuns(
    ctx: RequestContext,
    automationId: string,
    limit = DEFAULT_RUN_LIMIT,
  ): Promise<LeadFlowAutomationRunEntity[]> {
    return this.runsRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        automationId,
      },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(1, limit), MAX_RUN_LIMIT),
    });
  }

  async getRun(
    ctx: RequestContext,
    automationId: string,
    runId: string,
  ): Promise<LeadFlowAutomationRunWithAttempts> {
    const run = await this.runsRepository.findOne({
      where: {
        id: runId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        automationId,
      },
    });

    if (!run) {
      throw new NotFoundException('Execução não encontrada neste contexto.');
    }

    const attempts = await this.attemptsRepository.find({
      where: {
        runId: run.id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: { attemptNumber: 'ASC' },
    });

    return { run, attempts };
  }

  /** Attempts for several runs at once, keyed by run id. */
  async attemptsForRuns(
    ctx: RequestContext,
    runIds: string[],
  ): Promise<Map<string, LeadFlowAutomationRunAttemptEntity[]>> {
    if (runIds.length === 0) {
      return new Map();
    }

    const attempts = await this.attemptsRepository.find({
      where: {
        runId: In(runIds),
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: { attemptNumber: 'ASC' },
    });

    const grouped = new Map<string, LeadFlowAutomationRunAttemptEntity[]>();
    for (const attempt of attempts) {
      const list = grouped.get(attempt.runId) ?? [];
      list.push(attempt);
      grouped.set(attempt.runId, list);
    }
    return grouped;
  }
}

/**
 * True only when every signal the configuration required was actually observed.
 *
 * A single gap, or a single value that came from a simulator default, is enough
 * to make the verdict partly assumed — there is no partial credit, because a
 * decision is only as sound as its weakest input.
 */
function isFullyObserved(snapshot: LeadFlowAutomationContextSnapshot): boolean {
  if (snapshot.gaps.length > 0) return false;
  return snapshot.required.every((signal) => {
    const resolved = snapshot.resolved[signal];
    return (
      resolved?.origin === 'from_event' || resolved?.origin === 'canonical_read'
    );
  });
}

function uuidFrom(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
