import { Inject, Injectable } from '@nestjs/common';
import { SCHEDULER_RUNTIME, type SchedulerRuntime } from '../scheduler';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import { LEADFLOW_APPOINTMENT_TIMER_CONSUMER } from '../services/leadflow-appointment-timer.consumer';
import { executorAvailability } from './automation-executors.registry';
import type {
  AutomationEffectRequest,
  AutomationEffectResult,
  AutomationExecutor,
  AutomationExecutorAvailability,
} from './automation-executor.types';

/**
 * Turns "remind before this commitment" into durable timers.
 *
 * The trigger and the effect are far apart in time here, which is what makes
 * this a scheduling action rather than a send: `appointment.created` arrives
 * when the booking is made, but the reminder belongs to a moment defined by the
 * commitment itself. Sending on the trigger would send the 24h reminder at the
 * instant of booking.
 *
 * One timer per configured offset, each idempotent on its own key, so a
 * redelivered event re-schedules nothing and a partially scheduled set can be
 * completed by a retry. An offset whose instant has already passed is skipped
 * rather than fired immediately: a "24h before" message delivered thirty
 * minutes before the appointment is not a late reminder, it is a wrong one.
 */
@Injectable()
export class ScheduleAppointmentReminderExecutor implements AutomationExecutor {
  readonly actionKey = 'schedule_appointment_reminder';

  constructor(
    @Inject(SCHEDULER_RUNTIME) private readonly scheduler: SchedulerRuntime,
  ) {}

  availability(): AutomationExecutorAvailability {
    return executorAvailability(this.actionKey);
  }

  async execute(
    request: AutomationEffectRequest,
  ): Promise<AutomationEffectResult> {
    const appointmentId = stringField(request.payload.appointmentId);
    const startsAt = stringField(request.payload.startsAt);
    const conversationId = stringField(request.payload.conversationId);
    const offsets = offsetMinutes(request.payload.offsets);
    const startsAtMs = startsAt ? Date.parse(startsAt) : Number.NaN;

    if (
      !appointmentId ||
      !startsAt ||
      !conversationId ||
      !Number.isFinite(startsAtMs) ||
      offsets.length === 0
    ) {
      return refused(
        'appointment_reminder_unconfigured',
        'O lembrete exige compromisso com horário, conversa e antecedências válidas.',
      );
    }

    const now = Date.now();
    const scheduledTimerIds: string[] = [];
    const skippedOffsets: number[] = [];

    for (const minutesBefore of offsets) {
      const fireAt = startsAtMs - minutesBefore * 60_000;
      if (fireAt <= now) {
        skippedOffsets.push(minutesBefore);
        continue;
      }
      try {
        const handle = await this.scheduler.schedule({
          tenantId: request.tenantId,
          workspaceId: request.workspaceId,
          // The start instant is part of the key on purpose: a commitment moved
          // to another time is a different reminder, not the same one late.
          timerKey: `appointment_reminder:${request.automationId}:${appointmentId}:${startsAt}:${minutesBefore}`,
          dedupeScope: request.automationId,
          fireAt: new Date(fireAt).toISOString(),
          purpose: 'appointment_reminder',
          consumerKey: LEADFLOW_APPOINTMENT_TIMER_CONSUMER,
          payload: {
            ...request.payload,
            kind: 'appointment_reminder',
            automationId: request.automationId,
            appointmentId,
            conversationId,
            expectedStartsAt: startsAt,
            reminderOffsetMinutes: minutesBefore,
            actorRef: request.actorRef,
            policyRef: request.policyRef,
            correlationId: request.correlationId,
          },
        });
        scheduledTimerIds.push(handle.timerId);
      } catch {
        return {
          status: 'failed',
          effectConfirmed: scheduledTimerIds.length > 0,
          errorClass: LeadFlowAutomationErrorClass.Transient,
          errorCode: 'appointment_reminder_schedule_failed',
          errorMessage: 'O timer do lembrete não pôde ser persistido.',
          reference: scheduledTimerIds[0] ?? null,
          details: { scheduledTimerIds, skippedOffsets },
        };
      }
    }

    if (scheduledTimerIds.length === 0) {
      return refused(
        'appointment_reminder_window_passed',
        'Todas as antecedências configuradas já haviam passado quando o compromisso foi criado.',
      );
    }

    return {
      status: 'confirmed',
      effectConfirmed: true,
      reference: scheduledTimerIds[0],
      details: { scheduledTimerIds, skippedOffsets },
    };
  }
}

function refused(
  errorCode: string,
  errorMessage: string,
): AutomationEffectResult {
  return {
    status: 'refused',
    effectConfirmed: false,
    errorClass: LeadFlowAutomationErrorClass.Permanent,
    errorCode,
    errorMessage,
    reference: null,
  };
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Configured lead times, in minutes, largest first and de-duplicated.
 *
 * Ordering matters only for which timer id becomes the effect's reference;
 * de-duplication matters because two identical offsets would produce the same
 * timer key and silently look like one scheduling failure.
 */
function offsetMinutes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const minutes = (value as unknown[])
    .map((entry) =>
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as Record<string, unknown>).minutesBefore
        : entry,
    )
    .filter(
      (entry): entry is number =>
        typeof entry === 'number' && Number.isFinite(entry) && entry >= 0,
    )
    .map((entry) => Math.floor(entry));
  return [...new Set(minutes)].sort((left, right) => right - left);
}
