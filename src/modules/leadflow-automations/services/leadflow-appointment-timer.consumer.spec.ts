import { LeadFlowAppointmentTimerConsumer } from './leadflow-appointment-timer.consumer';
import type { TimerFireEnvelope } from '../scheduler';

const APPOINTMENT = 'a1b2c3d4-0000-4000-8000-000000000001';
const CONVERSATION = 'c1b2c3d4-0000-4000-8000-000000000002';
const STARTS_AT = new Date('2026-08-01T13:00:00.000Z');

function envelope(payload: Record<string, unknown> = {}): TimerFireEnvelope {
  return {
    timerId: 'timer-1',
    timerKey: 'appointment_reminder:automation-1:x:y:120',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    purpose: 'appointment_reminder',
    consumerKey: 'leadflow.automations.appointment',
    scheduledAt: '2026-07-31T13:00:00.000Z',
    firedAt: '2026-08-01T11:00:00.000Z',
    attempt: 1,
    payload: {
      kind: 'appointment_reminder',
      automationId: 'automation-1',
      appointmentId: APPOINTMENT,
      conversationId: CONVERSATION,
      expectedStartsAt: STARTS_AT.toISOString(),
      reminderOffsetMinutes: 120,
      text: 'Lembrete do seu compromisso.',
      ...payload,
    } as never,
  };
}

function harness(
  overrides: {
    appointment?: Record<string, unknown> | null;
    conversation?: Record<string, unknown> | null;
    gateAllowed?: boolean;
    automationRecipe?: string;
  } = {},
) {
  const registry = { register: jest.fn(), resolve: jest.fn() };
  const gate = {
    evaluate: jest
      .fn()
      .mockResolvedValue(
        overrides.gateAllowed === false
          ? { allowed: false, reason: 'execution_disabled' }
          : { allowed: true },
      ),
  };
  const sendMessage = {
    execute: jest.fn().mockResolvedValue({
      status: 'confirmed',
      effectConfirmed: true,
      reference: 'msg-1',
    }),
  };
  const automations = {
    findOne: jest.fn().mockResolvedValue({
      id: 'automation-1',
      publishedVersionId: 'version-1',
      recipeKey: overrides.automationRecipe ?? 'appointment_reminder',
    }),
  };
  const appointments = {
    findOne: jest.fn().mockResolvedValue(
      overrides.appointment === null
        ? null
        : {
            id: APPOINTMENT,
            startAt: STARTS_AT,
            dueAt: null,
            status: 'scheduled',
            metadata: { appointmentStatus: 'confirmed' },
            sourceConversationId: CONVERSATION,
            sourceOpportunityId: null,
            ...(overrides.appointment ?? {}),
          },
    ),
  };
  const conversations = {
    findOne: jest.fn().mockResolvedValue(
      overrides.conversation === null
        ? null
        : {
            id: CONVERSATION,
            status: 'open',
            ownershipState: 'ai_active',
            ownershipVersion: 4,
            metadata: {},
            ...(overrides.conversation ?? {}),
          },
    ),
  };
  const outbox = {
    insert: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((row: Record<string, unknown>) => row),
  };
  const appointmentsService = {
    markNoShowIfDue: jest.fn().mockResolvedValue('marked'),
  };

  const consumer = new LeadFlowAppointmentTimerConsumer(
    registry as never,
    gate as never,
    sendMessage as never,
    automations as never,
    appointments as never,
    conversations as never,
    outbox as never,
    appointmentsService as never,
  );
  return {
    consumer,
    gate,
    sendMessage,
    automations,
    appointmentsService,
    outbox,
    registry,
  };
}

function outboxEvents(outbox: { insert: jest.Mock }): string[] {
  return (outbox.insert.mock.calls as unknown[][]).map(
    ([row]) => (row as { eventName: string }).eventName,
  );
}

describe('LeadFlowAppointmentTimerConsumer', () => {
  it('registers itself under the appointment consumer key', () => {
    const { consumer, registry } = harness();
    consumer.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(consumer);
    expect(consumer.consumerKey).toBe('leadflow.automations.appointment');
  });

  it('publishes reminder_due and sends the reminder when nothing changed', async () => {
    const { consumer, sendMessage, outbox } = harness();

    await consumer.handleTimer(envelope());

    expect(outboxEvents(outbox)).toEqual([
      'leadflow.calendar.appointment.reminder_due',
      'leadflow.automations.appointment.reminder_result',
    ]);
    const [sent] = sendMessage.execute.mock.calls[0] as [
      { actionKey: string; payload: Record<string, unknown> },
    ];
    expect(sent.actionKey).toBe('send_message');
    expect(sent.payload).toMatchObject({
      conversationId: CONVERSATION,
      channel: 'whatsapp',
      text: 'Lembrete do seu compromisso.',
    });
  });

  it('is idempotent per timer: the same fire produces the same effect key', async () => {
    const { consumer, sendMessage } = harness();

    await consumer.handleTimer(envelope());
    await consumer.handleTimer(envelope());

    const [first, second] = sendMessage.execute.mock.calls.map(
      ([call]) => (call as { idempotencyKey: string }).idempotencyKey,
    );
    expect(first).toBe(second);
  });

  it.each([
    ['canceled', { metadata: { appointmentStatus: 'canceled' } }],
    ['no_show', { metadata: { appointmentStatus: 'no_show' } }],
    ['completed', { metadata: { appointmentStatus: 'completed' } }],
    ['rescheduled', { metadata: { appointmentStatus: 'rescheduled' } }],
  ])('says nothing about a %s commitment', async (_label, appointment) => {
    const { consumer, sendMessage, outbox } = harness({ appointment });

    await consumer.handleTimer(envelope());

    expect(sendMessage.execute).not.toHaveBeenCalled();
    expect(outbox.insert).not.toHaveBeenCalled();
  });

  it('drops a timer whose commitment has moved to another time', async () => {
    const { consumer, sendMessage } = harness({
      appointment: { startAt: new Date('2026-08-02T13:00:00.000Z') },
    });

    await consumer.handleTimer(envelope());

    expect(sendMessage.execute).not.toHaveBeenCalled();
  });

  it('does not interrupt a human who took the conversation over', async () => {
    const { consumer, sendMessage, outbox } = harness({
      conversation: { ownershipState: 'human_active' },
    });

    await consumer.handleTimer(envelope());

    expect(sendMessage.execute).not.toHaveBeenCalled();
    expect(outbox.insert).not.toHaveBeenCalled();
  });

  it('records the reminder window even when the gate refuses the send', async () => {
    const { consumer, sendMessage, outbox } = harness({ gateAllowed: false });

    await consumer.handleTimer(envelope());

    // The window really was reached; only the effect was withheld.
    expect(outboxEvents(outbox)).toEqual([
      'leadflow.calendar.appointment.reminder_due',
    ]);
    expect(sendMessage.execute).not.toHaveBeenCalled();
  });

  it('retries a transport failure but accepts a policy refusal', async () => {
    const failing = harness();
    failing.sendMessage.execute.mockResolvedValueOnce({
      status: 'failed',
      effectConfirmed: false,
      errorCode: 'message_send_failed',
    });
    await expect(failing.consumer.handleTimer(envelope())).rejects.toThrow(
      'appointment_reminder_message_failed',
    );

    const refused = harness();
    refused.sendMessage.execute.mockResolvedValueOnce({
      status: 'refused',
      effectConfirmed: false,
      errorCode: 'whatsapp_template_required',
    });
    await expect(
      refused.consumer.handleTimer(envelope()),
    ).resolves.toBeUndefined();
  });

  it('rejects a payload that is not an appointment reminder', async () => {
    const { consumer } = harness();
    await expect(
      consumer.handleTimer(envelope({ kind: 'followup_delivery' })),
    ).rejects.toThrow('appointment_timer_payload_invalid');
  });

  it('publishes confirmation_pending when the configured window is reached', async () => {
    const { consumer, outbox } = harness({
      automationRecipe: 'appointment_confirmation',
      appointment: {
        metadata: {
          appointmentStatus: 'pending',
          confirmationDueAt: '2026-07-31T13:00:00.000Z',
        },
      },
    });

    await consumer.handleTimer(
      envelope({
        kind: 'appointment_confirmation',
        expectedConfirmationDueAt: '2026-07-31T13:00:00.000Z',
      }),
    );

    expect(outboxEvents(outbox)).toEqual([
      'leadflow.calendar.appointment.confirmation_pending',
    ]);
  });

  it('drops an obsolete confirmation timer after the deadline changes', async () => {
    const { consumer, outbox } = harness({
      automationRecipe: 'appointment_confirmation',
      appointment: {
        metadata: {
          appointmentStatus: 'pending',
          confirmationDueAt: '2026-08-01T10:00:00.000Z',
        },
      },
    });

    await consumer.handleTimer(
      envelope({
        kind: 'appointment_confirmation',
        expectedConfirmationDueAt: '2026-07-31T13:00:00.000Z',
      }),
    );

    expect(outbox.insert).not.toHaveBeenCalled();
  });

  it('marks an overdue pending appointment as no-show behind the gate', async () => {
    const { consumer, appointmentsService, gate } = harness({
      automationRecipe: 'appointment_no_show_recovery',
      appointment: { metadata: { appointmentStatus: 'pending' } },
    });

    const noShowEnvelope = envelope({
      kind: 'appointment_no_show_check',
      expectedCheckAt: '2026-08-01T13:30:00.000Z',
    });
    noShowEnvelope.firedAt = '2026-08-01T14:00:00.000Z';
    await consumer.handleTimer(noShowEnvelope);

    expect(gate.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ actionKeys: ['schedule_followup'] }),
    );
    expect(appointmentsService.markNoShowIfDue).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
      }),
      APPOINTMENT,
      STARTS_AT.toISOString(),
      new Date('2026-08-01T14:00:00.000Z'),
    );
  });

  it('does not mutate appointment state while the execution gate is closed', async () => {
    const { consumer, appointmentsService } = harness({
      automationRecipe: 'appointment_no_show_recovery',
      gateAllowed: false,
      appointment: { metadata: { appointmentStatus: 'pending' } },
    });

    await consumer.handleTimer(
      envelope({
        kind: 'appointment_no_show_check',
        expectedCheckAt: '2026-08-01T10:30:00.000Z',
      }),
    );

    expect(appointmentsService.markNoShowIfDue).not.toHaveBeenCalled();
  });
});
