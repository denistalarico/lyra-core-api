import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import type { LeadFlowAutomationRecipeCatalogItem } from '../catalog/automation-recipes.catalog';
import {
  LeadFlowAutomationRunAttemptEntity,
  LeadFlowAutomationRunEntity,
} from '../entities';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import {
  LeadFlowAutomationAttemptStatus,
  LeadFlowAutomationRunMode,
} from '../enums/leadflow-automation-run.enums';
import type { LeadFlowJsonObject } from '../types/leadflow-automation.types';
import type { LeadFlowAutomationEvaluation } from './leadflow-automation-evaluation.service';

const AGENCY_CONNECTION = 'agency';

/** Runs are history, not a feed — a page is enough for the detail view. */
const DEFAULT_RUN_LIMIT = 25;
const MAX_RUN_LIMIT = 100;

export interface LeadFlowAutomationRunWithAttempts {
  run: LeadFlowAutomationRunEntity;
  attempts: LeadFlowAutomationRunAttemptEntity[];
}

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
    recipe: LeadFlowAutomationRecipeCatalogItem | undefined,
    evaluation: LeadFlowAutomationEvaluation,
    extras: { blockedByDependency: boolean } = { blockedByDependency: false },
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
          blockedByDependency: extras.blockedByDependency,
        },
        result: {
          wouldAct: evaluation.wouldAct,
          checks: evaluation.checks as unknown as LeadFlowJsonObject[],
          plannedActions: evaluation.plannedActions,
          blockedByDependency: extras.blockedByDependency,
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
