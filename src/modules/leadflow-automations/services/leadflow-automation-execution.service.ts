import { createHash } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities/leadflow-event-delivery.entity';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import type { LeadFlowAutomationVersionEntity } from '../entities/leadflow-automation-version.entity';
import type { AutomationEffectRequest, AutomationExecutor } from '../executors';
import { MoveOpportunityStageExecutor } from '../executors/move-opportunity-stage.executor';
import { AssignOpportunityOwnerExecutor } from '../executors/assign-opportunity-owner.executor';
import { RequestHandoffExecutor } from '../executors/request-handoff.executor';
import { NotifyUserExecutor } from '../executors/notify-user.executor';
import { ScheduleFollowupExecutor } from '../executors/schedule-followup.executor';
import { SendMessageExecutor } from '../executors/send-message.executor';
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

/** The aggregate an effect can be aimed at, resolved from the event envelope. */
interface EffectSubject {
  opportunityId: string | null;
  conversationId: string | null;
}

/** Actions whose effect targets a CRM opportunity in the envelope. */
const OPPORTUNITY_ACTIONS = new Set<string>([
  'move_opportunity_stage',
  'assign_opportunity_owner',
  // notify_user routes to the opportunity's owner when no explicit target is set.
  'notify_user',
]);

/** Actions whose effect targets an inbox conversation in the envelope. */
const CONVERSATION_ACTIONS = new Set<string>([
  'request_handoff',
  'send_message',
]);

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
    requestHandoffExecutor: RequestHandoffExecutor,
    notifyUserExecutor: NotifyUserExecutor,
    @Optional() scheduleFollowupExecutor?: ScheduleFollowupExecutor,
    @Optional() sendMessageExecutor?: SendMessageExecutor,
  ) {
    // The productive executors this phase wires. The gate's action allowlist is
    // the authority on what may run; this map is what *can*.
    this.executors = new Map<string, AutomationExecutor>([
      [moveStageExecutor.actionKey, moveStageExecutor],
      [assignOwnerExecutor.actionKey, assignOwnerExecutor],
      [requestHandoffExecutor.actionKey, requestHandoffExecutor],
      [notifyUserExecutor.actionKey, notifyUserExecutor],
    ]);
    if (scheduleFollowupExecutor) {
      this.executors.set(
        scheduleFollowupExecutor.actionKey,
        scheduleFollowupExecutor,
      );
    }
    if (sendMessageExecutor) {
      this.executors.set(sendMessageExecutor.actionKey, sendMessageExecutor);
    }
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

    // Scope of every effect: the aggregate the envelope names. Each action can
    // only be aimed at the aggregate kind its owning domain concerns — a CRM
    // effect at the opportunity, a handoff at the conversation. An effect
    // pointed at the wrong kind of subject cannot be attempted.
    const subject: EffectSubject = {
      opportunityId:
        delivery.aggregateType === 'crm_opportunity'
          ? delivery.aggregateId
          : null,
      conversationId:
        delivery.aggregateType === 'inbox_conversation'
          ? delivery.aggregateId
          : null,
    };
    if (actionKeys.some((key) => OPPORTUNITY_ACTIONS.has(key))) {
      if (!subject.opportunityId) {
        return { executed: false, reason: 'no_opportunity_in_envelope' };
      }
    }
    if (actionKeys.some((key) => CONVERSATION_ACTIONS.has(key))) {
      if (!subject.conversationId) {
        return { executed: false, reason: 'no_conversation_in_envelope' };
      }
    }
    if (
      actionKeys.includes('schedule_followup') &&
      !subject.conversationId &&
      !subject.opportunityId
    ) {
      return { executed: false, reason: 'no_followup_subject_in_envelope' };
    }

    const effects: LeadFlowAutomationLiveEffect[] = [];
    for (const actionKey of actionKeys) {
      const executor = this.executors.get(actionKey);
      if (!executor) {
        // The gate allowlist should prevent this; refuse loudly rather than
        // silently dropping a planned action.
        return { executed: false, reason: 'executor_not_wired' };
      }

      const request = this.buildRequest(input, subject, actionKey);
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
    subject: EffectSubject,
    actionKey: string,
  ): AutomationEffectRequest {
    const { automation, delivery, contextSnapshot, version } = input;

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
    const { payload, policyPrefix } = this.effectPayload(
      automation,
      delivery,
      subject,
      actionKey,
    );

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
      policyRef: `${policyPrefix}:${version.id}`,
      payload,
      revalidation: {
        contextSchemaVersion: contextSnapshot.schemaVersion,
        capturedAt: contextSnapshot.capturedAt,
        subjects: subjectsToRecord(contextSnapshot.subjects),
        expectedVersion,
      },
    };
  }

  /**
   * The action-specific effect input and its governing-policy prefix, resolved
   * from the automation config and the envelope's subject. The scope, idempotency
   * and revalidation around it are identical regardless of effect.
   */
  private effectPayload(
    automation: LeadFlowAutomationEntity,
    delivery: LeadFlowEventDeliveryEntity,
    subject: EffectSubject,
    actionKey: string,
  ): { payload: LeadFlowJsonObject; policyPrefix: string } {
    if (actionKey === 'request_handoff') {
      // The domain derives and clamps the reason; the executor defaults it when
      // absent. Keeping it null here keeps the handoff config surface untouched.
      return {
        policyPrefix: 'handoff',
        payload: { conversationId: subject.conversationId, reason: null },
      };
    }

    if (actionKey === 'notify_user') {
      // Recipient is the configured target, else the opportunity owner (resolved
      // by the publisher). The message frames the only trigger wired to this
      // action today — a hot lead crossing its threshold.
      const config = automation.actionConfig ?? {};
      return {
        policyPrefix: 'notify',
        payload: {
          opportunityId: subject.opportunityId,
          targetUserId:
            typeof config.targetUserRef === 'string'
              ? config.targetUserRef
              : null,
          title: 'Lead quente',
          body: 'Um lead cruzou o limiar de qualificação — priorize o atendimento.',
          actionUrl: '/leadflow/crm',
        },
      };
    }

    if (actionKey === 'schedule_followup') {
      return {
        policyPrefix: 'followup',
        payload: this.followupPayload(automation, delivery, subject),
      };
    }

    if (actionKey === 'send_message') {
      const message = automation.messageConfig ?? {};
      return {
        policyPrefix: 'message',
        payload: {
          conversationId: subject.conversationId,
          text:
            typeof message.baseMessage === 'string'
              ? message.baseMessage
              : null,
          templateRef:
            typeof message.templateRef === 'string'
              ? message.templateRef
              : null,
          templateLanguage:
            typeof message.templateLanguage === 'string'
              ? message.templateLanguage
              : 'pt_BR',
        },
      };
    }

    if (actionKey === 'assign_opportunity_owner') {
      return {
        policyPrefix: 'lead_distribution',
        payload: this.distributionPayload(automation, subject.opportunityId),
      };
    }

    const crmPolicy = automation.crmPolicy ?? {};
    return {
      policyPrefix: 'stage_transition',
      payload: {
        opportunityId: subject.opportunityId,
        toStageId:
          typeof crmPolicy.moveStageOnComplete === 'string'
            ? crmPolicy.moveStageOnComplete
            : null,
        reasonCode:
          typeof crmPolicy.moveStageReasonCode === 'string'
            ? crmPolicy.moveStageReasonCode
            : null,
      },
    };
  }

  /** The lead-distribution effect's input, read from the automation config. */
  private distributionPayload(
    automation: LeadFlowAutomationEntity,
    opportunityId: string | null,
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

  private followupPayload(
    automation: LeadFlowAutomationEntity,
    delivery: LeadFlowEventDeliveryEntity,
    subject: EffectSubject,
  ): LeadFlowJsonObject {
    const trigger = automation.triggerConfig ?? {};
    const actions = automation.actionConfig ?? {};
    const conditions = automation.conditionConfig ?? {};
    const message = automation.messageConfig ?? {};
    const schedule = automation.schedulePolicy ?? {};
    const baselineAt =
      typeof delivery.payload?.idleSince === 'string'
        ? delivery.payload.idleSince
        : delivery.occurredAt.toISOString();
    const baseline = new Date(baselineAt);
    const safeBaseline = Number.isFinite(baseline.getTime())
      ? baseline
      : delivery.occurredAt;
    const maxAttempts = clampInteger(actions.maxAttempts, 1, 7, 1);

    const configuredSteps = Array.isArray(message.followupSteps)
      ? message.followupSteps
          .filter(
            (step) =>
              typeof step === 'object' &&
              step !== null &&
              !Array.isArray(step) &&
              typeof step.delayMinutes === 'number' &&
              Number.isFinite(step.delayMinutes) &&
              step.delayMinutes >= 0,
          )
          .slice(0, maxAttempts)
      : [];
    let offsets: number[];
    let firstOffset: number;
    if (configuredSteps.length > 0) {
      offsets = configuredSteps.map((step) => step.delayMinutes / 60);
      firstOffset = offsets[0];
    } else if (delivery.eventName === 'leadflow.inbox.conversation.idle') {
      const delay = positiveNumber(trigger.delayHours, 24);
      offsets = [delay, delay * 3, delay * 7].slice(0, maxAttempts);
      firstOffset = delay;
    } else {
      const idle = positiveNumber(trigger.idleHoursInStage, 48);
      const cooldown = positiveNumber(schedule.cooldownHours, idle);
      offsets = Array.from(
        { length: maxAttempts },
        (_, index) => idle + cooldown * index,
      );
      firstOffset = idle;
    }
    const firstDue = new Date(
      safeBaseline.getTime() + firstOffset * 60 * 60 * 1_000,
    );
    const fireAt = new Date(Math.max(Date.now(), firstDue.getTime()));

    return {
      conversationId: subject.conversationId,
      opportunityId:
        subject.opportunityId ??
        (typeof delivery.payload?.opportunityId === 'string'
          ? delivery.payload.opportunityId
          : null),
      expectedStageId:
        typeof delivery.payload?.toStageId === 'string'
          ? delivery.payload.toStageId
          : null,
      baselineAt: safeBaseline.toISOString(),
      fireAt: fireAt.toISOString(),
      attemptOffsetsHours: offsets,
      stopIfReplied: conditions.stopIfReplied !== false,
      stopIfHandoff: conditions.stopIfHandoff !== false,
      respectBusinessHours:
        conditions.businessHoursOnly === true ||
        schedule.respectBusinessHours !== false,
      text:
        typeof message.baseMessage === 'string' ? message.baseMessage : null,
      templateRef:
        typeof message.templateRef === 'string' ? message.templateRef : null,
      templateLanguage:
        typeof message.templateLanguage === 'string'
          ? message.templateLanguage
          : 'pt_BR',
      followupSteps: configuredSteps.length > 0 ? configuredSteps : null,
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

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}
