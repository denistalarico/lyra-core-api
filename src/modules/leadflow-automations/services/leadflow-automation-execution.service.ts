import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities/leadflow-event-delivery.entity';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import type { LeadFlowAutomationVersionEntity } from '../entities/leadflow-automation-version.entity';
import type {
  AutomationEffectRequest,
  AutomationExecutor,
} from '../executors';
import { MoveOpportunityStageExecutor } from '../executors/move-opportunity-stage.executor';
import { AssignOpportunityOwnerExecutor } from '../executors/assign-opportunity-owner.executor';
import type { LeadFlowJsonObject } from '../types/leadflow-automation.types';
import type { LeadFlowAutomationContextSnapshot } from '../types/leadflow-automation-context.types';
import type { LeadFlowAutomationTrigger } from '../types/leadflow-automation.types';
import type { LeadFlowAutomationEvaluation } from './leadflow-automation-evaluation.service';
import { LeadFlowAutomationExecutionGate } from './leadflow-automation-execution-gate.service';
import {
  LeadFlowAutomationRunService,
  type LeadFlowAutomationLiveEffect,
} from './leadflow-automation-run.service';

type RunRecipe = { trigger: LeadFlowAutomationTrigger; triggerKind: 'event' };

export interface ExecutionInput {
  automation: LeadFlowAutomationEntity;
  version: LeadFlowAutomationVersionEntity;
  recipe: RunRecipe | undefined;
  evaluation: LeadFlowAutomationEvaluation;
  delivery: LeadFlowEventDeliveryEntity;
  contextSnapshot: LeadFlowAutomationContextSnapshot;
}

export type ExecutionOutcome =
  /** The gate permitted execution and a live run was recorded. */
  | { executed: true; runId: string }
  /** The gate refused; the caller should record a shadow run instead. */
  | { executed: false; reason: string };

/**
 * Carries out the planned actions of an eligible verdict, behind the gate.
 *
 * This is the only place a real effect is requested. It is reached only after
 * the evaluator found the automation would act and every planned action has an
 * available executor. Even then, it asks the gate first: with the canary switch
 * off — the default — it never executes, and tells the caller to record a
 * shadow run as before. Nothing here decides what an effect means; it resolves
 * the effect request from configuration and hands it to the owning domain's
 * executor.
 */
@Injectable()
export class LeadFlowAutomationExecutionService {
  private readonly logger = new Logger(LeadFlowAutomationExecutionService.name);
  private readonly executors: Map<string, AutomationExecutor>;

  constructor(
    private readonly gate: LeadFlowAutomationExecutionGate,
    private readonly runService: LeadFlowAutomationRunService,
    moveStageExecutor: MoveOpportunityStageExecutor,
    assignOwnerExecutor: AssignOpportunityOwnerExecutor,
  ) {
    // The productive executors this phase wires. The gate's action allowlist is
    // the authority on what may run; this map is what *can*.
    this.executors = new Map<string, AutomationExecutor>([
      [moveStageExecutor.actionKey, moveStageExecutor],
      [assignOwnerExecutor.actionKey, assignOwnerExecutor],
    ]);
  }

  async execute(input: ExecutionInput): Promise<ExecutionOutcome> {
    const { automation, delivery, evaluation } = input;
    const actionKeys = evaluation.plannedActions;

    const decision = await this.gate.evaluate({
      tenantId: automation.tenantId,
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      actionKeys,
    });
    if (!decision.allowed) {
      return { executed: false, reason: decision.reason };
    }

    // Scope of every effect: the opportunity the envelope names. A stage move
    // cannot be aimed by anything other than the aggregate the event concerns.
    const opportunityId =
      delivery.aggregateType === 'crm_opportunity'
        ? delivery.aggregateId
        : null;
    if (!opportunityId) {
      return { executed: false, reason: 'no_opportunity_in_envelope' };
    }

    const effects: LeadFlowAutomationLiveEffect[] = [];
    for (const actionKey of actionKeys) {
      const executor = this.executors.get(actionKey);
      if (!executor) {
        // The gate allowlist should prevent this; refuse loudly rather than
        // silently dropping a planned action.
        return { executed: false, reason: 'executor_not_wired' };
      }

      const request = this.buildRequest(input, opportunityId, actionKey);
      const startedAt = Date.now();
      const result = await executor.execute(request);
      effects.push({ actionKey, result, durationMs: Date.now() - startedAt });

      // A refusal or failure stops the sequence: later actions may depend on the
      // earlier effect having landed, and carrying on would act on a false
      // premise. What ran is still recorded.
      if (result.status !== 'confirmed') break;
    }

    const { run } = await this.runService.recordLiveRun(
      automation,
      input.version,
      input.recipe,
      evaluation,
      { delivery, contextSnapshot: input.contextSnapshot, effects },
    );

    if (effects.some((effect) => effect.result.status === 'failed')) {
      this.logger.warn(
        `Live automation ${automation.id} had a failed effect on run ${run.id}.`,
      );
    }

    return { executed: true, runId: run.id };
  }

  private buildRequest(
    input: ExecutionInput,
    opportunityId: string,
    actionKey: string,
  ): AutomationEffectRequest {
    const { automation, delivery, contextSnapshot, version } = input;
    const crmPolicy = automation.crmPolicy ?? {};

    const idempotencyKey = `effect:${createHash('sha256')
      .update(
        [
          delivery.tenantId,
          delivery.workspaceId,
          delivery.sourceEventId,
          automation.id,
          actionKey,
        ].join(':'),
      )
      .digest('hex')}`;

    const expectedVersion =
      typeof delivery.payload?.rowVersion === 'number'
        ? delivery.payload.rowVersion
        : null;

    // Each action carries its own configured input; the rest of the request —
    // scope, idempotency, revalidation — is the same regardless of effect.
    const isDistribution = actionKey === 'assign_opportunity_owner';
    const payload: LeadFlowJsonObject = isDistribution
      ? this.distributionPayload(automation, opportunityId)
      : {
          opportunityId,
          toStageId:
            typeof crmPolicy.moveStageOnComplete === 'string'
              ? crmPolicy.moveStageOnComplete
              : null,
          reasonCode:
            typeof crmPolicy.moveStageReasonCode === 'string'
              ? crmPolicy.moveStageReasonCode
              : null,
        };

    return {
      tenantId: automation.tenantId,
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      runId: delivery.sourceEventId,
      attemptNumber: 1,
      actionKey,
      correlationId: uuidOrEvent(delivery),
      idempotencyKey,
      // An effect nobody can be held responsible for must not be attempted.
      actorRef: `automation:${automation.id}`,
      policyRef: `${
        isDistribution ? 'lead_distribution' : 'stage_transition'
      }:${version.id}`,
      payload,
      revalidation: {
        contextSchemaVersion: contextSnapshot.schemaVersion,
        capturedAt: contextSnapshot.capturedAt,
        subjects: subjectsToRecord(contextSnapshot.subjects),
        expectedVersion,
      },
    };
  }

  /** The lead-distribution effect's input, read from the automation config. */
  private distributionPayload(
    automation: LeadFlowAutomationEntity,
    opportunityId: string,
  ): LeadFlowJsonObject {
    const config = automation.actionConfig ?? {};
    return {
      opportunityId,
      strategy:
        typeof config.distributionStrategy === 'string'
          ? config.distributionStrategy
          : 'least_volume',
      channelMap:
        config.distributionChannelMap &&
        typeof config.distributionChannelMap === 'object' &&
        !Array.isArray(config.distributionChannelMap)
          ? config.distributionChannelMap
          : null,
      fallbackUserId:
        typeof config.distributionFallbackUserRef === 'string'
          ? config.distributionFallbackUserRef
          : null,
    };
  }
}

function subjectsToRecord(
  subjects: LeadFlowAutomationContextSnapshot['subjects'],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(subjects)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function uuidOrEvent(delivery: LeadFlowEventDeliveryEntity): string {
  const value = delivery.payload?.correlationId;
  return typeof value === 'string' ? value : delivery.sourceEventId;
}
