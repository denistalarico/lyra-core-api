import { Inject, Injectable } from '@nestjs/common';
import { SCHEDULER_RUNTIME, type SchedulerRuntime } from '../scheduler';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import { executorAvailability } from './automation-executors.registry';
import type {
  AutomationEffectRequest,
  AutomationEffectResult,
  AutomationExecutor,
  AutomationExecutorAvailability,
} from './automation-executor.types';
import { LEADFLOW_FOLLOWUP_TIMER_CONSUMER } from '../services/leadflow-followup-timer.consumer';

/** Schedules the first durable delivery in a follow-up chain. */
@Injectable()
export class ScheduleFollowupExecutor implements AutomationExecutor {
  readonly actionKey = 'schedule_followup';

  constructor(
    @Inject(SCHEDULER_RUNTIME) private readonly scheduler: SchedulerRuntime,
  ) {}

  availability(): AutomationExecutorAvailability {
    return executorAvailability(this.actionKey);
  }

  async execute(
    request: AutomationEffectRequest,
  ): Promise<AutomationEffectResult> {
    const fireAt = stringField(request.payload.fireAt);
    const subjectId =
      stringField(request.payload.conversationId) ??
      stringField(request.payload.opportunityId);
    const baselineAt = stringField(request.payload.baselineAt);
    if (!fireAt || !subjectId || !baselineAt) {
      return {
        status: 'refused',
        effectConfirmed: false,
        errorClass: LeadFlowAutomationErrorClass.Permanent,
        errorCode: 'followup_schedule_unconfigured',
        errorMessage:
          'O follow-up exige sujeito, instante-base e vencimento válidos.',
        reference: null,
      };
    }

    try {
      const handle = await this.scheduler.schedule({
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        timerKey: `followup:${request.automationId}:${subjectId}:${baselineAt}:1`,
        dedupeScope: request.automationId,
        fireAt,
        purpose: 'automation_followup',
        consumerKey: LEADFLOW_FOLLOWUP_TIMER_CONSUMER,
        payload: {
          ...request.payload,
          kind: 'followup_delivery',
          automationId: request.automationId,
          attemptIndex: 0,
          actorRef: request.actorRef,
          policyRef: request.policyRef,
          correlationId: request.correlationId,
        },
      });
      return {
        status: 'confirmed',
        effectConfirmed: true,
        reference: handle.timerId,
      };
    } catch {
      return {
        status: 'failed',
        effectConfirmed: false,
        errorClass: LeadFlowAutomationErrorClass.Transient,
        errorCode: 'followup_schedule_failed',
        errorMessage: 'O timer do follow-up não pôde ser persistido.',
        reference: null,
      };
    }
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
