import { Injectable, Logger } from '@nestjs/common';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities/leadflow-event-delivery.entity';
import { unavailableExecutors } from '../executors';
import { LeadFlowAutomationRecipeService } from './leadflow-automation-recipe.service';
import {
  LeadFlowAutomationEvaluationService,
  type LeadFlowAutomationEvaluationContext,
} from './leadflow-automation-evaluation.service';
import { LeadFlowAutomationRunService } from './leadflow-automation-run.service';
import { LeadFlowAutomationTriggerMatcherService } from './leadflow-automation-trigger-matcher.service';

/**
 * Signals a condition may depend on, and where each one came from.
 *
 * Recorded per run because a verdict computed from defaults is weaker than one
 * computed from observed state, and the difference must be visible. Without
 * this an operator could read "would act" as certainty when half the inputs
 * were assumptions.
 */
export type SignalOrigin = 'from_event' | 'defaulted';

export interface ShadowEvaluationSummary {
  automationId: string;
  runId: string;
  wouldAct: boolean;
  blockedByExecutor: boolean;
}

/**
 * Evaluates real delivered triggers without carrying out any effect.
 *
 * This closes the loop the ingress deliberately left open: a delivery is
 * matched to automations, the same deterministic evaluator used by the dry-run
 * decides, and the outcome is recorded as a `shadow` run. Nothing is executed —
 * every action still resolves to an unavailable executor — so the value here is
 * observability: seeing which automations *would* have fired on real traffic,
 * before any effect is switched on.
 */
@Injectable()
export class LeadFlowAutomationShadowEvaluatorService {
  private readonly logger = new Logger(
    LeadFlowAutomationShadowEvaluatorService.name,
  );

  constructor(
    private readonly matcher: LeadFlowAutomationTriggerMatcherService,
    private readonly recipeService: LeadFlowAutomationRecipeService,
    private readonly evaluationService: LeadFlowAutomationEvaluationService,
    private readonly runService: LeadFlowAutomationRunService,
  ) {}

  /**
   * Evaluates every automation matching a delivered event.
   *
   * Never throws: shadow evaluation is observability, so a failure here must not
   * fail the delivery that produced it. The ingress owns delivery state.
   */
  async evaluateDelivery(
    delivery: LeadFlowEventDeliveryEntity,
  ): Promise<ShadowEvaluationSummary[]> {
    try {
      const automations = await this.matcher.findMatching(
        delivery.tenantId,
        delivery.workspaceId,
        delivery.eventName,
      );
      if (automations.length === 0) return [];

      const { context, origins } = this.deriveContext(delivery);
      const summaries: ShadowEvaluationSummary[] = [];

      for (const automation of automations) {
        const recipe = this.recipeService.getRecipe(automation.recipeKey);
        const evaluation = this.evaluationService.evaluate(
          automation,
          recipe,
          context,
        );

        // Even a passing evaluation cannot act: no productive executor exists.
        const blocked = unavailableExecutors(evaluation.plannedActions);

        const { run } = await this.runService.recordShadowRun(
          automation,
          recipe,
          evaluation,
          {
            delivery,
            signalOrigins: origins,
            unavailableActions: blocked,
          },
        );

        summaries.push({
          automationId: automation.id,
          runId: run.id,
          wouldAct: evaluation.wouldAct,
          blockedByExecutor: blocked.length > 0,
        });
      }

      return summaries;
    } catch (error) {
      this.logger.warn(
        `Shadow evaluation failed for delivery ${delivery.id}: ${
          error instanceof Error ? error.name : 'unknown_error'
        }`,
      );
      return [];
    }
  }

  /**
   * Builds an evaluation context from the event payload alone.
   *
   * Deliberately does not read the CRM or Inbox to enrich it. Reading canonical
   * state from here would put cross-domain queries inside a background loop that
   * runs on every event, and the value does not yet justify that coupling — the
   * outcome is recorded, not acted on. Signals the payload cannot supply are
   * marked `defaulted` so the verdict is never mistaken for a full observation.
   */
  private deriveContext(delivery: LeadFlowEventDeliveryEntity): {
    context: LeadFlowAutomationEvaluationContext;
    origins: Record<string, SignalOrigin>;
  } {
    const payload = delivery.payload ?? {};
    const context: LeadFlowAutomationEvaluationContext = {};
    const origins: Record<string, SignalOrigin> = {
      leadScore: 'defaulted',
      leadReplied: 'defaulted',
      handoffActive: 'defaulted',
      insideBusinessHours: 'defaulted',
      attemptsSoFar: 'defaulted',
      hoursSinceLastRun: 'defaulted',
    };

    const score = payload.score ?? payload.leadScore;
    if (typeof score === 'number' && Number.isFinite(score)) {
      context.leadScore = score;
      origins.leadScore = 'from_event';
    }

    // A handoff event is itself the evidence; no lookup needed.
    if (delivery.eventName.includes('handoff')) {
      context.handoffActive = true;
      origins.handoffActive = 'from_event';
    }

    // An inbound message event means the lead has spoken.
    if (delivery.eventName.includes('message.received')) {
      context.leadReplied = true;
      origins.leadReplied = 'from_event';
    }

    return { context, origins };
  }
}
