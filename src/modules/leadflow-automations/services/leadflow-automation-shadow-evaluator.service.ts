import { Injectable } from '@nestjs/common';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities/leadflow-event-delivery.entity';
import type { LeadFlowAutomationTrigger } from '../types/leadflow-automation.types';
import { unavailableExecutors } from '../executors';
import {
  LeadFlowAutomationRunStatus,
  LeadFlowAutomationSkipReason,
} from '../enums/leadflow-automation-run.enums';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { LeadFlowAutomationContextService } from './leadflow-automation-context.service';
import {
  LeadFlowAutomationEvaluationService,
  type LeadFlowAutomationEvaluationRecipe,
} from './leadflow-automation-evaluation.service';
import { LeadFlowAutomationExecutionService } from './leadflow-automation-execution.service';
import { LeadFlowAutomationRunService } from './leadflow-automation-run.service';
import {
  type LeadFlowAutomationTriggerMatch,
  LeadFlowAutomationTriggerMatcherService,
} from './leadflow-automation-trigger-matcher.service';

export interface ShadowEvaluationSummary {
  automationId: string;
  automationVersionId: string;
  runId: string;
  wouldAct: boolean;
  blockedByExecutor: boolean;
  /** True when the gate permitted a real effect and a live run was recorded. */
  executed: boolean;
  /** Required signals that could not be established for this evaluation. */
  contextGapCount: number;
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
 *
 * Context is resolved per automation and only for the signals that automation's
 * published configuration actually consults, so an event concerning nobody
 * costs nothing beyond the match query.
 */
@Injectable()
export class LeadFlowAutomationShadowEvaluatorService {
  constructor(
    private readonly matcher: LeadFlowAutomationTriggerMatcherService,
    private readonly contextService: LeadFlowAutomationContextService,
    private readonly evaluationService: LeadFlowAutomationEvaluationService,
    private readonly runService: LeadFlowAutomationRunService,
    private readonly executionService: LeadFlowAutomationExecutionService,
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
    // Envelope-only filtering first: tenant, workspace and trigger decide
    // relevance before any context work is even considered.
    const matches = await this.matcher.findMatching(
      delivery.tenantId,
      delivery.workspaceId,
      delivery.eventName,
    );
    if (matches.length === 0) return [];

    // One batched context load for the whole delivery: every matched automation
    // reacting to the same event asks about the same conversation and
    // opportunity, so the reads are shared rather than repeated per automation.
    const resolutions = await this.contextService.resolveForDelivery(
      matches.map((match) => match.automation),
      delivery,
    );

    const summaries: ShadowEvaluationSummary[] = [];

    for (const match of matches) {
      const { automation, source, version } = match;
      const recipe = this.publishedRecipe(automation);
      const resolution =
        resolutions.get(automation.id) ??
        this.contextService.resolveFromEnvelope(automation, delivery);
      const evaluated = this.evaluationService.evaluate(
        automation,
        recipe,
        resolution.context,
        resolution.gaps,
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
      // productive adapter available.
      const blocked = unavailableExecutors(evaluation.plannedActions);
      const eligibleForExecution = evaluation.wouldAct && blocked.length === 0;

      // When the verdict could act and nothing is capability-blocked, offer it
      // to execution. The gate — closed by default — decides whether anything
      // actually happens; if it refuses, we fall through to a shadow run exactly
      // as before, so the default behaviour of the whole platform is unchanged.
      if (eligibleForExecution) {
        const outcome = await this.executionService.execute({
          automation,
          version,
          recipe,
          evaluation,
          delivery,
          contextSnapshot: resolution.snapshot,
        });
        if (outcome.executed) {
          summaries.push({
            automationId: automation.id,
            automationVersionId: version.id,
            runId: outcome.runId,
            wouldAct: evaluation.wouldAct,
            blockedByExecutor: false,
            executed: true,
            contextGapCount: resolution.snapshot.gaps.length,
          });
          continue;
        }
      }

      const { run } = await this.runService.recordShadowRun(
        automation,
        version,
        recipe,
        evaluation,
        {
          delivery,
          contextSnapshot: resolution.snapshot,
          unavailableActions: blocked,
        },
      );

      summaries.push({
        automationId: automation.id,
        automationVersionId: version.id,
        runId: run.id,
        wouldAct: evaluation.wouldAct,
        blockedByExecutor: blocked.length > 0,
        executed: false,
        contextGapCount: resolution.snapshot.gaps.length,
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
}
