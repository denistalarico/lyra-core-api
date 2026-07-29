import { ScheduleAppointmentReminderExecutor } from './schedule-appointment-reminder.executor';
import type { AutomationEffectRequest } from './automation-executor.types';

const APPOINTMENT = 'a1b2c3d4-0000-4000-8000-000000000001';
const CONVERSATION = 'c1b2c3d4-0000-4000-8000-000000000002';

function schedulerStub() {
  const schedule = jest.fn((request: { timerKey: string }) =>
    Promise.resolve({
      timerId: `timer:${request.timerKey}`,
      timerKey: request.timerKey,
      status: 'scheduled' as const,
      fireAt: new Date().toISOString(),
    }),
  );
  return { schedule, cancel: jest.fn(), reschedule: jest.fn() };
}

function request(payload: Record<string, unknown>): AutomationEffectRequest {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    automationId: 'automation-1',
    runId: 'run-1',
    attemptNumber: 1,
    actionKey: 'schedule_appointment_reminder',
    correlationId: 'corr-1',
    idempotencyKey: 'effect:1',
    actorRef: 'automation:automation-1',
    policyRef: 'appointment_reminder:v1',
    payload: payload as never,
    revalidation: {
      contextSchemaVersion: 1,
      capturedAt: new Date().toISOString(),
      subjects: { scheduled_item: APPOINTMENT },
      expectedVersion: null,
    },
  };
}

function inHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

describe('ScheduleAppointmentReminderExecutor', () => {
  it('persists one timer per offset that has not passed yet', async () => {
    const scheduler = schedulerStub();
    const executor = new ScheduleAppointmentReminderExecutor(scheduler);
    const startsAt = inHours(3);

    const result = await executor.execute(
      request({
        appointmentId: APPOINTMENT,
        conversationId: CONVERSATION,
        startsAt,
        offsets: [
          { label: '24h antes', minutesBefore: 1440 },
          { label: '2h antes', minutesBefore: 120 },
          { label: '30min antes', minutesBefore: 30 },
        ],
        text: 'Lembrete',
      }),
    );

    // The 24h offset already elapsed for a commitment three hours away: firing
    // it now would deliver a "tomorrow" reminder about today.
    expect(result.status).toBe('confirmed');
    expect(scheduler.schedule).toHaveBeenCalledTimes(2);
    expect(result.details).toMatchObject({ skippedOffsets: [1440] });
    const fired = scheduler.schedule.mock.calls.map(
      ([call]) =>
        (call as unknown as { payload: Record<string, unknown> }).payload,
    );
    expect(fired.map((payload) => payload.reminderOffsetMinutes)).toEqual([
      120, 30,
    ]);
    expect(
      fired.every((payload) => payload.kind === 'appointment_reminder'),
    ).toBe(true);
    expect(
      fired.every((payload) => payload.expectedStartsAt === startsAt),
    ).toBe(true);
  });

  it('keys each timer by the commitment and its start instant', async () => {
    const scheduler = schedulerStub();
    const executor = new ScheduleAppointmentReminderExecutor(scheduler);
    const startsAt = inHours(48);

    await executor.execute(
      request({
        appointmentId: APPOINTMENT,
        conversationId: CONVERSATION,
        startsAt,
        offsets: [{ minutesBefore: 120 }],
      }),
    );

    expect(scheduler.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        timerKey: `appointment_reminder:automation-1:${APPOINTMENT}:${startsAt}:120`,
        dedupeScope: 'automation-1',
        purpose: 'appointment_reminder',
        consumerKey: 'leadflow.automations.appointment',
      }),
    );
  });

  it('refuses when the commitment carries no time, conversation or offsets', async () => {
    const scheduler = schedulerStub();
    const executor = new ScheduleAppointmentReminderExecutor(scheduler);

    const noTime = await executor.execute(
      request({
        appointmentId: APPOINTMENT,
        conversationId: CONVERSATION,
        startsAt: null,
        offsets: [{ minutesBefore: 30 }],
      }),
    );
    const noConversation = await executor.execute(
      request({
        appointmentId: APPOINTMENT,
        conversationId: null,
        startsAt: inHours(4),
        offsets: [{ minutesBefore: 30 }],
      }),
    );
    const noOffsets = await executor.execute(
      request({
        appointmentId: APPOINTMENT,
        conversationId: CONVERSATION,
        startsAt: inHours(4),
        offsets: [],
      }),
    );

    for (const result of [noTime, noConversation, noOffsets]) {
      expect(result.status).toBe('refused');
      expect(result.errorCode).toBe('appointment_reminder_unconfigured');
    }
    expect(scheduler.schedule).not.toHaveBeenCalled();
  });

  it('refuses instead of firing when every offset is already in the past', async () => {
    const scheduler = schedulerStub();
    const executor = new ScheduleAppointmentReminderExecutor(scheduler);

    const result = await executor.execute(
      request({
        appointmentId: APPOINTMENT,
        conversationId: CONVERSATION,
        startsAt: inHours(0.1),
        offsets: [{ minutesBefore: 1440 }, { minutesBefore: 120 }],
      }),
    );

    expect(result.status).toBe('refused');
    expect(result.errorCode).toBe('appointment_reminder_window_passed');
    expect(scheduler.schedule).not.toHaveBeenCalled();
  });

  it('reports a transient failure without claiming the timers that did land', async () => {
    const scheduler = schedulerStub();
    scheduler.schedule.mockRejectedValueOnce(new Error('db down'));
    const executor = new ScheduleAppointmentReminderExecutor(scheduler);

    const result = await executor.execute(
      request({
        appointmentId: APPOINTMENT,
        conversationId: CONVERSATION,
        startsAt: inHours(48),
        offsets: [{ minutesBefore: 1440 }, { minutesBefore: 120 }],
      }),
    );

    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('appointment_reminder_schedule_failed');
    expect(result.effectConfirmed).toBe(false);
  });
});
