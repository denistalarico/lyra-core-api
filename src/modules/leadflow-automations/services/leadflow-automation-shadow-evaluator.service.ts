import { Injectable } from '@nestjs/common';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities/leadflow-event-delivery.entity';
import type { LeadFlowAutomationTrigger } from '../types/leadflow-automation.types';
import { unavailableExecutors } from '../executors';
import {
  LeadFlowAutomationRunStatus,
  LeadFlowAutomationSkipReason,
} from '../enums/leadflow-automation-run.enums';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import {
  LeadFlowAutomationEvaluationService,
  type LeadFlowAutomationEvaluationContext,
  type LeadFlowAutomationEvaluationRecipe,
} from './leadflow-automation-evaluation.service';
import { LeadFlowAutomationRunService } from './leadflow-automation-run.service';
import {
  type LeadFlowAutomationTriggerMatch,
  LeadFlowAutomationTriggerMatcherService,
} from './leadflow-automation-trigger-matcher.service';

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
  automationVersionId: string;
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
  constructor(
    private readonly matcher: LeadFlowAutomationTriggerMatcherService,
    private readonly evaluationService: LeadFlowAutomationEvaluationService,
    private readonly runService: LeadFlowAutomationRunService,
  ) {}

  /**
   * Evaluates every automation matching a delivered event.
   *
   * Throws on persistence failure. Ingress acknowledges the delivery only after
   * all matching runs exist; a retry is safe because each run is idempotent on
   * source event + automation; the first run pins the published version.
   */
  async evaluateDelivery(
    delivery: LeadFlowEventDeliveryEntity,
  ): Promise<ShadowEvaluationSummary[]> {
    const matches = await this.matcher.findMatching(
      delivery.tenantId,
      delivery.workspaceId,
      delivery.eventName,
    );
    if (matches.length === 0) return [];

    const { context, origins } = this.deriveContext(delivery);
    const summaries: ShadowEvaluationSummary[] = [];

    for (const match of matches) {
      const { automation, source, version } = match;
      const recipe = this.publishedRecipe(automation);
      const evaluated = this.evaluationService.evaluate(
        automation,
        recipe,
        context,
      );
      const evaluation =
        source.status === LeadFlowAutomationStatus.Active
          ? evaluated
          : {
              ...evaluated,
              wouldAct: false,
              status: LeadFlowAutomationRunStatus.Skipped,
              skipReason: LeadFlowAutomationSkipReason.NotActive,
              plannedActions: [],
            };

      // Even a passing evaluation cannot act until every planned action has a
      // productive adapter. Shadow records that fact and requests no effect.
      const blocked = unavailableExecutors(evaluation.plannedActions);

      const { run } = await this.runService.recordShadowRun(
        automation,
        version,
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
        automationVersionId: version.id,
        runId: run.id,
        wouldAct: evaluation.wouldAct,
        blockedByExecutor: blocked.length > 0,
      });
    }

    return summaries;
  }

  /**
   * Reconstructs the small recipe surface used by evaluation from the
   * published snapshot. Catalog defaults may evolve after publication and must
   * not rewrite the meaning of an already published automation.
   */
  private publishedRecipe(
    automation: LeadFlowAutomationTriggerMatch['automation'],
  ):
    | (LeadFlowAutomationEvaluationRecipe & {
        trigger: LeadFlowAutomationTrigger;
        triggerKind: 'event';
      })
    | undefined {
    const trigger = automation.triggerConfig?.type;
    const primaryAction = automation.actionConfig?.primaryAction;
    if (typeof trigger !== 'string' || typeof primaryAction !== 'string') {
      return undefined;
    }
    return {
      // Compatibility was resolved at publish time and the snapshot pins the
      // selected mode. A later catalog change cannot invalidate that verdict.
      businessModeKeys: 'all',
      primaryAction,
      trigger,
      triggerKind: 'event',
    };
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
