import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { ScheduledItemEntity } from '../../appointments/entities/scheduled-item.entity';
import { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import { SCHEDULER_RUNTIME, type SchedulerRuntime } from '../scheduler';
import { LEADFLOW_APPOINTMENT_TIMER_CONSUMER } from './leadflow-appointment-timer.consumer';
import { LeadFlowAutomationTriggerMatcherService } from './leadflow-automation-trigger-matcher.service';

const OBSERVED_EVENTS = new Set([
  'leadflow.calendar.appointment.created',
  'leadflow.calendar.appointment.updated',
]);

const APPOINTMENT_TYPES = new Set(['event', 'meeting', 'call']);
const INACTIVE_LIFECYCLES = new Set([
  'canceled',
  'completed',
  'no_show',
  'rescheduled',
]);

/**
 * Reconciles the two domain clocks that exist before an appointment event:
 * confirmation window and attendance/no-show check.
 *
 * The service observes the durable event delivery instead of an HTTP request,
 * so imports, integrations and operator edits use the same path. Reprocessing
 * is harmless: the appointment start instant and automation id are part of
 * each timer key, while the timer consumer re-reads canonical state before
 * producing a fact.
 */
@Injectable()
export class LeadFlowAppointmentLifecycleSchedulerService {
  constructor(
    @Inject(SCHEDULER_RUNTIME) private readonly scheduler: SchedulerRuntime,
    private readonly matcher: LeadFlowAutomationTriggerMatcherService,
    @InjectRepository(ScheduledItemEntity, 'agency')
    private readonly appointments: Repository<ScheduledItemEntity>,
  ) {}

  async observeDelivery(delivery: LeadFlowEventDeliveryEntity): Promise<void> {
    if (!OBSERVED_EVENTS.has(delivery.eventName)) return;

    const appointmentId =
      stringField(delivery.payload?.appointmentId) ??
      (delivery.aggregateType === 'scheduled_item'
        ? delivery.aggregateId
        : null);
    if (!appointmentId) return;

    const appointment = await this.appointments.findOne({
      where: {
        id: appointmentId,
        tenantId: delivery.tenantId,
        workspaceId: delivery.workspaceId,
        deletedAt: IsNull(),
      },
    });
    if (
      !appointment ||
      !APPOINTMENT_TYPES.has(appointment.type) ||
      INACTIVE_LIFECYCLES.has(lifecycleStatus(appointment))
    ) {
      return;
    }

    const startsAt = appointment.startAt ?? appointment.dueAt;
    if (!startsAt) return;

    const [confirmationMatches, noShowMatches] = await Promise.all([
      this.matcher.findMatchingTrigger(
        delivery.tenantId,
        delivery.workspaceId,
        'appointment.confirmation_pending',
      ),
      this.matcher.findMatchingTrigger(
        delivery.tenantId,
        delivery.workspaceId,
        'appointment.no_show',
      ),
    ]);

    if (lifecycleStatus(appointment) === 'pending') {
      for (const match of confirmationMatches) {
        if (match.automation.recipeKey !== 'appointment_confirmation') continue;
        await this.scheduleConfirmation(
          delivery,
          appointment,
          startsAt,
          match.automation.id,
          numberField(
            match.automation.triggerConfig?.confirmationHoursBefore,
            24,
          ),
        );
      }
    }

    for (const match of noShowMatches) {
      if (match.automation.recipeKey !== 'appointment_no_show_recovery') {
        continue;
      }
      await this.scheduleNoShowCheck(
        delivery,
        appointment,
        startsAt,
        match.automation.id,
        numberField(match.automation.triggerConfig?.noShowGraceMinutes, 30),
      );
    }
  }

  private async scheduleConfirmation(
    delivery: LeadFlowEventDeliveryEntity,
    appointment: ScheduledItemEntity,
    startsAt: Date,
    automationId: string,
    hoursBefore: number,
  ): Promise<void> {
    const configured = dateField(appointment.metadata?.confirmationDueAt);
    const dueAt =
      configured ??
      new Date(startsAt.getTime() - hoursBefore * 60 * 60 * 1_000);

    // AppointmentsService publishes an already-due confirmation window in the
    // lifecycle transaction. Scheduling it again would ask twice.
    if (dueAt.getTime() <= delivery.occurredAt.getTime()) return;

    await this.scheduler.schedule({
      tenantId: delivery.tenantId,
      workspaceId: delivery.workspaceId,
      timerKey:
        `appointment_confirmation:${automationId}:${appointment.id}:` +
        `${startsAt.toISOString()}:${dueAt.toISOString()}`,
      dedupeScope: automationId,
      // Keep the canonical deadline. The scheduler runtime decides whether an
      // overdue timer is due immediately; replacing it with wall-clock time
      // would make retries non-deterministic and change the timer key meaning.
      fireAt: dueAt.toISOString(),
      purpose: 'appointment_confirmation',
      consumerKey: LEADFLOW_APPOINTMENT_TIMER_CONSUMER,
      payload: {
        kind: 'appointment_confirmation',
        automationId,
        appointmentId: appointment.id,
        expectedStartsAt: startsAt.toISOString(),
        expectedConfirmationDueAt: dueAt.toISOString(),
        sourceEventId: delivery.sourceEventId,
      },
    });
  }

  private async scheduleNoShowCheck(
    delivery: LeadFlowEventDeliveryEntity,
    appointment: ScheduledItemEntity,
    startsAt: Date,
    automationId: string,
    graceMinutes: number,
  ): Promise<void> {
    const attendanceEndsAt = appointment.endAt ?? startsAt;
    const checkAt = new Date(
      attendanceEndsAt.getTime() + graceMinutes * 60 * 1_000,
    );
    await this.scheduler.schedule({
      tenantId: delivery.tenantId,
      workspaceId: delivery.workspaceId,
      timerKey:
        `appointment_no_show_check:${automationId}:${appointment.id}:` +
        `${startsAt.toISOString()}:${checkAt.toISOString()}`,
      dedupeScope: automationId,
      fireAt: checkAt.toISOString(),
      purpose: 'appointment_no_show_check',
      consumerKey: LEADFLOW_APPOINTMENT_TIMER_CONSUMER,
      payload: {
        kind: 'appointment_no_show_check',
        automationId,
        appointmentId: appointment.id,
        expectedStartsAt: startsAt.toISOString(),
        expectedCheckAt: checkAt.toISOString(),
        sourceEventId: delivery.sourceEventId,
      },
    });
  }
}

function lifecycleStatus(item: ScheduledItemEntity): string {
  const explicit = item.metadata?.appointmentStatus;
  if (typeof explicit === 'string' && explicit.trim()) return explicit;
  if (item.status === 'completed') return 'completed';
  if (item.status === 'canceled') return 'canceled';
  if (item.status === 'missed') return 'no_show';
  if (item.status === 'postponed') return 'rescheduled';
  return 'confirmed';
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function dateField(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function numberField(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}
