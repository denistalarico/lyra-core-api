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
import { ScheduleAppointmentReminderExecutor } from '../executors/schedule-appointment-reminder.executor';
import { SendMessageExecutor } from '../executors/send-message.executor';
import { AddOpportunityTagExecutor } from '../executors/add-opportunity-tag.executor';
import { RequestCsatExecutor } from '../executors/request-csat.executor';
import { GenerateDailySummaryExecutor } from '../executors/generate-daily-summary.executor';
import { GOVERNED_STAGE_ADVANCE_RECIPE_KEY } from '../catalog/automation-recipes.catalog';
import {
  enabledFollowupSteps,
  toStoredFollowupSteps,
} from '../catalog/followup-plan.catalog';
import type { LeadFlowJsonObject } from '../types/leadflow-automation.types';
import {
  LeadFlowAutomationContextSignal,
  type LeadFlowAutomationAppointmentContext,
  type LeadFlowAutomationContextSnapshot,
} from '../types/leadflow-automation-context.types';
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
  appointmentId: string | null;
}

/** Actions whose effect targets a CRM opportunity in the envelope. */
const OPPORTUNITY_ACTIONS = new Set<string>([
  'move_opportunity_stage',
  'assign_opportunity_owner',
  // notify_user routes to the opportunity's owner when no explicit target is set.
  'notify_user',
  'add_tag',
  'request_csat',
]);

/** Actions whose effect targets an inbox conversation in the envelope. */
const CONVERSATION_ACTIONS = new Set<string>([
  'request_handoff',
  'send_message',
]);

/** Actions whose effect is about a commitment in the Agenda. */
const APPOINTMENT_ACTIONS = new Set<string>(['schedule_appointment_reminder']);

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
    addTagExecutor: AddOpportunityTagExecutor,
    @Optional() scheduleFollowupExecutor?: ScheduleFollowupExecutor,
    @Optional()
    scheduleAppointmentReminderExecutor?: ScheduleAppointmentReminderExecutor,
    @Optional() sendMessageExecutor?: SendMessageExecutor,
    @Optional() requestCsatExecutor?: RequestCsatExecutor,
    @Optional() generateDailySummaryExecutor?: GenerateDailySummaryExecutor,
  ) {
    // The productive executors this phase wires. The gate's action allowlist is
    // the authority on what may run; this map is what *can*.
    this.executors = new Map<string, AutomationExecutor>([
      [moveStageExecutor.actionKey, moveStageExecutor],
      [assignOwnerExecutor.actionKey, assignOwnerExecutor],
      [requestHandoffExecutor.actionKey, requestHandoffExecutor],
      [notifyUserExecutor.actionKey, notifyUserExecutor],
      [addTagExecutor.actionKey, addTagExecutor],
    ]);
    if (scheduleFollowupExecutor) {
      this.executors.set(
        scheduleFollowupExecutor.actionKey,
        scheduleFollowupExecutor,
      );
    }
    if (scheduleAppointmentReminderExecutor) {
      this.executors.set(
        scheduleAppointmentReminderExecutor.actionKey,
        scheduleAppointmentReminderExecutor,
      );
    }
    if (sendMessageExecutor) {
      this.executors.set(sendMessageExecutor.actionKey, sendMessageExecutor);
    }
    if (requestCsatExecutor) {
      this.executors.set(requestCsatExecutor.actionKey, requestCsatExecutor);
    }
    if (generateDailySummaryExecutor) {
      this.executors.set(
        generateDailySummaryExecutor.actionKey,
        generateDailySummaryExecutor,
      );
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
    //
    // An agenda event names only the commitment, so the conversation and the
    // opportunity come from the links the Agenda itself wrote and the context
    // resolver already established. That is a followed reference, not a guess:
    // without it every agenda action would be permanently unaimed.
    const appointment = appointmentContextOf(input.contextSnapshot);
    const subject: EffectSubject = {
      opportunityId:
        delivery.aggregateType === 'crm_opportunity'
          ? delivery.aggregateId
          : (appointment?.opportunityId ?? null),
      conversationId:
        delivery.aggregateType === 'inbox_conversation'
          ? delivery.aggregateId
          : (appointment?.conversationId ?? null),
      appointmentId:
        delivery.aggregateType === 'scheduled_item'
          ? delivery.aggregateId
          : (appointment?.appointmentId ?? null),
    };
    if (actionKeys.some((key) => APPOINTMENT_ACTIONS.has(key))) {
      // The guard must hold at execution time too: the verdict may have been
      // reached from a snapshot, but the effect is aimed with these values.
      if (!subject.appointmentId || !appointment) {
        return { executed: false, reason: 'no_appointment_in_envelope' };
      }
    }
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
      appointmentContextOf(contextSnapshot),
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
    appointment: LeadFlowAutomationAppointmentContext | null,
  ): { payload: LeadFlowJsonObject; policyPrefix: string } {
    if (actionKey === 'schedule_appointment_reminder') {
      const message = automation.messageConfig ?? {};
      const schedule = automation.schedulePolicy ?? {};
      return {
        policyPrefix: 'appointment_reminder',
        payload: {
          appointmentId: subject.appointmentId,
          conversationId: subject.conversationId,
          startsAt: appointment?.startsAt ?? null,
          timezone: appointment?.timezone ?? null,
          serviceRef: appointment?.serviceRef ?? null,
          offsets: Array.isArray(schedule.offsets) ? schedule.offsets : [],
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
          notifyOpportunityOwner: config.notifyOpportunityOwner !== false,
          notifyPipelineOwner: config.notifyPipelineOwner === true,
          notifyPipelineParticipants:
            config.notifyPipelineParticipants === true,
          specificRecipientUserIds: Array.isArray(
            config.specificRecipientUserRefs,
          )
            ? config.specificRecipientUserRefs
            : [],
          notificationChannels: Array.isArray(config.notificationChannels)
            ? config.notificationChannels
            : ['in_app'],
          cycleId: delivery.sourceEventId,
          policyVersion:
            typeof delivery.payload.policyVersion === 'string'
              ? delivery.payload.policyVersion
              : 'unknown',
          currentScore:
            typeof delivery.payload.currentScore === 'number'
              ? delivery.payload.currentScore
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

    if (actionKey === 'request_csat') {
      const message = automation.messageConfig ?? {};
      const schedule = automation.schedulePolicy ?? {};
      return {
        policyPrefix: 'csat',
        payload: {
          opportunityId: subject.opportunityId,
          // No channel: the executor reads it off the conversation, so the
          // request always leaves through the channel the lead came in on.
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
          responseWindowHours:
            typeof schedule.responseWindowHours === 'number'
              ? schedule.responseWindowHours
              : 168,
        },
      };
    }

    if (actionKey === 'generate_summary_placeholder') {
      const actions = automation.actionConfig ?? {};
      const schedule = automation.schedulePolicy ?? {};
      return {
        policyPrefix: 'daily_summary',
        payload: {
          targetUserId:
            typeof actions.targetUserRef === 'string'
              ? actions.targetUserRef
              : null,
          localDate:
            typeof delivery.payload.localDate === 'string'
              ? delivery.payload.localDate
              : null,
          timezone:
            typeof delivery.payload.timezone === 'string'
              ? delivery.payload.timezone
              : typeof schedule.timezone === 'string'
                ? schedule.timezone
                : 'UTC',
        },
      };
    }

    if (actionKey === 'add_tag') {
      return {
        policyPrefix: 'tag',
        payload: {
          opportunityId: subject.opportunityId,
          rules: this.tagRules(automation),
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
    // The governed stage advance is owned by the CRM: the published movement
    // rules decide which stage may follow the one the opportunity is in. Sending
    // a destination from the automation's own JSON would pin it to a single
    // stage that those rules no longer propose — which is what legacy instances
    // still carry, from when this screen asked for one. Withholding both values
    // is what puts the executor on the CRM-managed path.
    const crmManaged =
      automation.recipeKey === GOVERNED_STAGE_ADVANCE_RECIPE_KEY;
    return {
      policyPrefix: 'stage_transition',
      payload: {
        opportunityId: subject.opportunityId,
        toStageId:
          !crmManaged && typeof crmPolicy.moveStageOnComplete === 'string'
            ? crmPolicy.moveStageOnComplete
            : null,
        reasonCode:
          !crmManaged && typeof crmPolicy.moveStageReasonCode === 'string'
            ? crmPolicy.moveStageReasonCode
            : null,
      },
    };
  }

  /** The lead-distribution effect's input, read from the automation config. */
  /**
   * The tagging rules, as the executor consumes them.
   *
   * An instance provisioned before the rules became a list carries a single
   * field/operator/value in `conditions` and its tags in `actions.addTags` (or,
   * older still, in `crmPolicy.addTags`). Migration 1789800000000 rewrites those
   * rows, but reading them here too is what keeps a database that has not run it
   * yet — a staging copy, another environment — tagging exactly as before
   * instead of silently refusing every run as unconfigured.
   */
  private tagRules(automation: LeadFlowAutomationEntity): LeadFlowJsonObject[] {
    const conditions = automation.conditionConfig ?? {};
    if (Array.isArray(conditions.tagRules)) {
      return conditions.tagRules as LeadFlowJsonObject[];
    }

    const actions = automation.actionConfig ?? {};
    const crmPolicy = automation.crmPolicy ?? {};
    const legacyTags =
      Array.isArray(actions.addTags) && actions.addTags.length > 0
        ? actions.addTags
        : Array.isArray(crmPolicy.addTags)
          ? crmPolicy.addTags
          : [];
    if (typeof conditions.ruleField !== 'string' || legacyTags.length === 0) {
      return [];
    }

    return [
      {
        field: conditions.ruleField,
        operator:
          typeof conditions.ruleOperator === 'string'
            ? conditions.ruleOperator
            : 'is_present',
        value:
          typeof conditions.ruleValue === 'string'
            ? conditions.ruleValue
            : null,
        tagIds: legacyTags,
      },
    ];
  }

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
      // How the new owner hears about it. A row provisioned before the alert
      // existed carries no key, and inherits the recipe's default rather than
      // distributing leads in silence.
      notificationChannels: Array.isArray(config.notificationChannels)
        ? config.notificationChannels
        : ['in_app'],
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

    // The canonical cadence is the plan itself: four named attempts, of which
    // the enabled ones are the chain. `maxAttempts` no longer truncates it —
    // a stored 3 would silently drop D+7 from a plan the operator switched on.
    const canonicalPlan = automation.recipeKey === 'followup_idle_lead';
    const configuredSteps = canonicalPlan
      ? toStoredFollowupSteps(enabledFollowupSteps(message.followupSteps))
      : Array.isArray(message.followupSteps)
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
    const fromAppointment = isAppointmentEvent(delivery.eventName);
    let offsets: number[];
    let firstOffset: number;
    if (configuredSteps.length > 0) {
      offsets = configuredSteps.map((step) => step.delayMinutes / 60);
      firstOffset = offsets[0];
    } else if (delivery.eventName === 'leadflow.inbox.conversation.idle') {
      const delay = positiveNumber(trigger.delayHours, 24);
      offsets = [delay, delay * 3, delay * 7].slice(0, maxAttempts);
      firstOffset = delay;
    } else if (fromAppointment) {
      // The commitment already happened; the clock starts at the event, not at
      // a stage the opportunity may not even be sitting on.
      const delay = positiveNumber(trigger.delayHours, 1);
      const cooldown = positiveNumber(schedule.cooldownHours, delay);
      offsets = Array.from(
        { length: maxAttempts },
        (_, index) => delay + cooldown * index,
      );
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
      automationRecipeKey: automation.recipeKey,
      // `automation_reactivation` stays in the purpose vocabulary for timers
      // scheduled before the reactivation recipe was retired; nothing schedules
      // one now.
      timerPurpose: 'automation_followup',
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
      // The two flags answer different questions and must not be conflated. As
      // an entry condition, "did the lead reply" is about the whole
      // conversation, and an agenda recipe deliberately ignores it — a lead who
      // spoke to us months ago must still be recovered after a no-show. At the
      // timer it is about this chain only: someone who answered the recovery
      // message has been recovered, so the chain always stops there.
      stopIfReplied: fromAppointment || conditions.stopIfReplied !== false,
      stopIfHandoff: conditions.stopIfHandoff !== false,
      respectBusinessHours:
        conditions.businessHoursOnly === true ||
        schedule.respectBusinessHours !== false,
      // The zone the quiet-hours envelope is read in. Null lets the consumer
      // fall back to the workspace's own business-hours zone.
      timezone:
        typeof schedule.timezone === 'string' ? schedule.timezone : null,
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

/** The commitment the context resolver established, if this delivery is about one. */
function appointmentContextOf(
  snapshot: LeadFlowAutomationContextSnapshot,
): LeadFlowAutomationAppointmentContext | null {
  // A snapshot persisted under an earlier schema version may not carry the
  // section at all; an absent commitment is simply not an agenda delivery.
  const value =
    snapshot.resolved?.[LeadFlowAutomationContextSignal.AppointmentContext]
      ?.value;
  return value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as LeadFlowAutomationAppointmentContext).appointmentId ===
      'string'
    ? (value as LeadFlowAutomationAppointmentContext)
    : null;
}

function isAppointmentEvent(eventName: string): boolean {
  return eventName.startsWith('leadflow.calendar.appointment.');
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
