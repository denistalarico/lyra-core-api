import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { ScheduledItemEntity } from '../../appointments/entities/scheduled-item.entity';
import { InboxConversationEntity } from '../../inbox/entities/inbox-conversation.entity';
import { InboxDomainOutboxEntity } from '../../inbox/entities/inbox-domain-outbox.entity';
import { hasLeadFlowOutboundOptOut } from '../../inbox/services/leadflow-contact-opt-out';
import { LeadFlowAutomationEntity } from '../entities';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { SendMessageExecutor } from '../executors/send-message.executor';
import {
  ScheduledTimerConsumerRegistry,
  type ScheduledTimerConsumer,
  type TimerFireEnvelope,
} from '../scheduler';
import { LeadFlowAutomationExecutionGate } from './leadflow-automation-execution-gate.service';

export const LEADFLOW_APPOINTMENT_TIMER_CONSUMER =
  'leadflow.automations.appointment' as const;

/**
 * Lifecycle states in which nothing more should be said about a commitment.
 *
 * `rescheduled` is here with the cancellations on purpose: the commitment this
 * timer describes no longer exists at this time, and the new one produces its
 * own event and its own reminders.
 */
const TERMINAL_LIFECYCLE = new Set([
  'canceled',
  'no_show',
  'completed',
  'rescheduled',
]);

/** Ownership states that mean a human is handling the conversation. */
const HANDOFF_STATES = new Set(['handoff_requested', 'human_active']);

/** Storage status → canonical lifecycle, mirroring `AppointmentsService`. */
const LIFECYCLE_BY_STORAGE_STATUS: Record<string, string> = {
  completed: 'completed',
  canceled: 'canceled',
  missed: 'no_show',
  postponed: 'rescheduled',
};

/**
 * Delivers appointment reminders when their moment arrives.
 *
 * The timer carries a decision made when the commitment was booked, possibly
 * days earlier, so nothing here trusts it: the commitment is re-read, its
 * lifecycle and start instant are compared against what was scheduled, and the
 * conversation is checked for a human having taken over. A commitment that was
 * cancelled, already attended, moved to another time or handed to a person
 * produces a clean no-op — which is the whole reason the reminder is a timer
 * plus a revalidation instead of a queued message.
 *
 * `appointment.reminder_due` is published before the send. It records that the
 * reminder window was genuinely reached, which stays true whether or not the
 * canary gate lets a message go out, and it is the producer the event contract
 * has been reserving since the Agenda contracts were written.
 */
@Injectable()
export class LeadFlowAppointmentTimerConsumer
  implements ScheduledTimerConsumer, OnModuleInit
{
  readonly consumerKey = LEADFLOW_APPOINTMENT_TIMER_CONSUMER;

  constructor(
    private readonly registry: ScheduledTimerConsumerRegistry,
    private readonly gate: LeadFlowAutomationExecutionGate,
    private readonly sendMessage: SendMessageExecutor,
    @InjectRepository(LeadFlowAutomationEntity, 'agency')
    private readonly automations: Repository<LeadFlowAutomationEntity>,
    @InjectRepository(ScheduledItemEntity, 'agency')
    private readonly appointments: Repository<ScheduledItemEntity>,
    @InjectRepository(InboxConversationEntity, 'agency')
    private readonly conversations: Repository<InboxConversationEntity>,
    @InjectRepository(InboxDomainOutboxEntity, 'agency')
    private readonly outbox: Repository<InboxDomainOutboxEntity>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handleTimer(envelope: TimerFireEnvelope): Promise<void> {
    if (stringField(envelope.payload.kind) !== 'appointment_reminder') {
      throw new Error('appointment_timer_payload_invalid');
    }
    await this.deliverReminder(envelope);
  }

  private async deliverReminder(envelope: TimerFireEnvelope): Promise<void> {
    const automationId = stringField(envelope.payload.automationId);
    const appointmentId = stringField(envelope.payload.appointmentId);
    const expectedStartsAt = stringField(envelope.payload.expectedStartsAt);
    const offsetMinutes = integerField(envelope.payload.reminderOffsetMinutes);
    if (
      !automationId ||
      !appointmentId ||
      !expectedStartsAt ||
      offsetMinutes === null
    ) {
      throw new Error('appointment_reminder_payload_invalid');
    }

    const automation = await this.automations.findOne({
      where: {
        id: automationId,
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
        status: LeadFlowAutomationStatus.Active,
      },
    });
    if (!automation || !automation.publishedVersionId) return;

    const appointment = await this.appointments.findOne({
      where: {
        id: appointmentId,
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
        deletedAt: IsNull(),
      },
    });
    if (!appointment) return;
    if (TERMINAL_LIFECYCLE.has(lifecycleStatus(appointment))) return;

    // A moved commitment invalidates this timer entirely. The reminder for the
    // new time is scheduled by the automation that reacts to the change, never
    // by shifting a timer whose offset was computed from the old instant.
    const startsAt = appointment.startAt ?? appointment.dueAt;
    if (!startsAt || startsAt.toISOString() !== expectedStartsAt) return;

    const conversationId =
      appointment.sourceConversationId ??
      stringField(envelope.payload.conversationId);
    if (!conversationId) return;

    const conversation = await this.conversations.findOne({
      where: {
        id: conversationId,
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
      },
    });
    if (!conversation || isConversationTerminal(conversation)) return;
    // A human mid-handoff owns the relationship; an automated reminder landing
    // in the middle of that conversation contradicts them.
    if (HANDOFF_STATES.has(conversation.ownershipState)) return;
    if (hasLeadFlowOutboundOptOut(conversation)) return;

    await this.publishReminderDue(envelope, appointment, offsetMinutes);

    const gate = await this.gate.evaluate({
      tenantId: envelope.tenantId,
      workspaceId: envelope.workspaceId,
      automationId,
      actionKeys: ['send_message'],
    });
    if (!gate.allowed) return;

    const result = await this.sendMessage.execute({
      tenantId: envelope.tenantId,
      workspaceId: envelope.workspaceId,
      automationId,
      runId: envelope.timerId,
      attemptNumber: envelope.attempt,
      actionKey: 'send_message',
      correlationId:
        stringField(envelope.payload.correlationId) ?? envelope.timerId,
      idempotencyKey: effectKey(
        automationId,
        appointmentId,
        expectedStartsAt,
        offsetMinutes,
      ),
      actorRef:
        stringField(envelope.payload.actorRef) ?? `automation:${automationId}`,
      policyRef:
        stringField(envelope.payload.policyRef) ??
        `appointment_reminder:${automation.publishedVersionId}`,
      payload: {
        conversationId,
        channel: 'whatsapp',
        text: stringField(envelope.payload.text),
        templateRef: stringField(envelope.payload.templateRef),
        templateLanguage:
          stringField(envelope.payload.templateLanguage) ?? 'pt_BR',
      },
      revalidation: {
        contextSchemaVersion: 1,
        capturedAt: envelope.firedAt,
        subjects: {
          scheduled_item: appointmentId,
          inbox_conversation: conversationId,
          ...(appointment.sourceOpportunityId
            ? { crm_opportunity: appointment.sourceOpportunityId }
            : {}),
        },
        expectedVersion: conversation.ownershipVersion,
      },
    });

    await this.recordResult(envelope, appointmentId, offsetMinutes, result);

    // Only a transport failure is worth another attempt. A refusal — a closed
    // messaging window, a template the provider rejected — would refuse again.
    if (result.status === 'failed') {
      throw new Error('appointment_reminder_message_failed');
    }
  }

  /** The canonical "the reminder window was reached" event. */
  private async publishReminderDue(
    envelope: TimerFireEnvelope,
    appointment: ScheduledItemEntity,
    offsetMinutes: number,
  ): Promise<void> {
    const startsAt = appointment.startAt ?? appointment.dueAt;
    if (!startsAt) return;
    await this.insertOutbox(envelope, appointment.id, {
      eventName: 'leadflow.calendar.appointment.reminder_due',
      idempotencyKey: `appointment.reminder_due:${envelope.timerId}`,
      payload: {
        appointmentId: appointment.id,
        startsAt: startsAt.toISOString(),
        reminderOffsetMinutes: offsetMinutes,
      },
    });
  }

  /** Per-reminder delivery outcome, so a silent skip stays auditable. */
  private async recordResult(
    envelope: TimerFireEnvelope,
    appointmentId: string,
    offsetMinutes: number,
    result: { status: string; errorCode?: string; reference?: string | null },
  ): Promise<void> {
    await this.insertOutbox(envelope, appointmentId, {
      eventName: 'leadflow.automations.appointment.reminder_result',
      idempotencyKey: `appointment.reminder_result:${envelope.timerId}`,
      payload: {
        appointmentId,
        timerId: envelope.timerId,
        reminderOffsetMinutes: offsetMinutes,
        result: result.status,
        errorCode: result.errorCode ?? null,
        reference: result.reference ?? null,
      },
    });
  }

  private async insertOutbox(
    envelope: TimerFireEnvelope,
    appointmentId: string,
    event: {
      eventName: string;
      idempotencyKey: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await this.outbox.insert(
        this.outbox.create({
          tenantId: envelope.tenantId,
          workspaceId: envelope.workspaceId,
          aggregateType: 'scheduled_item',
          aggregateId: appointmentId,
          eventName: event.eventName,
          eventVersion: 1,
          idempotencyKey: event.idempotencyKey.slice(0, 180),
          payload: event.payload,
          publishedAt: null,
        }) as never,
      );
    } catch (error) {
      // At-least-once delivery may replay a timer whose event already landed.
      // Only the idempotency boundary is tolerated; never rewrite a published row.
      if (!isUniqueViolation(error)) throw error;
    }
  }
}

function lifecycleStatus(item: ScheduledItemEntity): string {
  const explicit = item.metadata?.appointmentStatus;
  if (typeof explicit === 'string' && explicit.trim()) return explicit;
  return LIFECYCLE_BY_STORAGE_STATUS[item.status] ?? 'confirmed';
}

function isConversationTerminal(
  conversation: InboxConversationEntity,
): boolean {
  return (
    conversation.ownershipState === 'closed' ||
    ['resolved', 'closed', 'archived'].includes(conversation.status)
  );
}

function effectKey(
  automationId: string,
  appointmentId: string,
  startsAt: string,
  offsetMinutes: number,
): string {
  return `appointment_reminder:${createHash('sha256')
    .update([automationId, appointmentId, startsAt, offsetMinutes].join(':'))
    .digest('hex')}`;
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integerField(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
