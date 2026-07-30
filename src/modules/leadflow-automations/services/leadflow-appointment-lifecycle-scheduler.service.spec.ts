import { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import type { ScheduledTimerHandle, ScheduleTimerRequest } from '../scheduler';
import type { LeadFlowAutomationTriggerMatch } from './leadflow-automation-trigger-matcher.service';
import { LeadFlowAppointmentLifecycleSchedulerService } from './leadflow-appointment-lifecycle-scheduler.service';

const APPOINTMENT = 'a1b2c3d4-0000-4000-8000-000000000001';
const STARTS_AT = new Date('2026-08-05T13:00:00.000Z');
const END_AT = new Date('2026-08-05T14:00:00.000Z');

function delivery(
  eventName = 'leadflow.calendar.appointment.created',
): LeadFlowEventDeliveryEntity {
  return Object.assign(new LeadFlowEventDeliveryEntity(), {
    id: 'delivery-1',
    sourceEventId: 'source-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    aggregateType: 'scheduled_item',
    aggregateId: APPOINTMENT,
    eventName,
    eventVersion: 1,
    payload: { appointmentId: APPOINTMENT },
    occurredAt: new Date('2026-08-01T12:00:00.000Z'),
  });
}

function automation(recipeKey: string, triggerConfig: Record<string, unknown>) {
  return {
    source: {},
    version: {},
    automation: {
      id: `${recipeKey}-automation`,
      recipeKey,
      triggerConfig,
    },
  };
}

function harness(
  appointment: Record<string, unknown> | null = {
    id: APPOINTMENT,
    type: 'meeting',
    status: 'scheduled',
    startAt: STARTS_AT,
    endAt: END_AT,
    dueAt: null,
    metadata: {
      appointmentStatus: 'pending',
      confirmationDueAt: '2026-08-04T13:00:00.000Z',
    },
  },
) {
  const confirmationMatch = automation('appointment_confirmation', {
    confirmationHoursBefore: 24,
  }) as unknown as LeadFlowAutomationTriggerMatch;
  const noShowMatch = automation('appointment_no_show_recovery', {
    noShowGraceMinutes: 30,
  }) as unknown as LeadFlowAutomationTriggerMatch;
  const scheduler = {
    schedule: jest
      .fn<Promise<ScheduledTimerHandle>, [ScheduleTimerRequest]>()
      .mockImplementation((request) =>
        Promise.resolve({
          timerId: request.timerKey,
          timerKey: request.timerKey,
          status: 'scheduled',
          fireAt: request.fireAt,
        }),
      ),
  };
  const matcher = {
    findMatchingTrigger: jest
      .fn<Promise<LeadFlowAutomationTriggerMatch[]>, [string, string, string]>()
      .mockImplementation((_tenantId, _workspaceId, trigger) =>
        Promise.resolve(
          trigger === 'appointment.confirmation_pending'
            ? [confirmationMatch]
            : [noShowMatch],
        ),
      ),
  };
  const appointments = {
    findOne: jest.fn().mockResolvedValue(appointment),
  };
  const service = new LeadFlowAppointmentLifecycleSchedulerService(
    scheduler as never,
    matcher as never,
    appointments as never,
  );
  return { appointments, matcher, scheduler, service };
}

describe('LeadFlowAppointmentLifecycleSchedulerService', () => {
  it('schedules confirmation and no-show clocks from the canonical appointment', async () => {
    const { scheduler, service } = harness();

    await service.observeDelivery(delivery());

    expect(scheduler.schedule).toHaveBeenCalledTimes(2);
    const [confirmation, noShow] = scheduler.schedule.mock.calls.map(
      ([request]) => request,
    );
    expect(confirmation).toMatchObject({
      purpose: 'appointment_confirmation',
      consumerKey: 'leadflow.automations.appointment',
      fireAt: '2026-08-04T13:00:00.000Z',
    });
    expect(confirmation.payload).toMatchObject({
      kind: 'appointment_confirmation',
      expectedStartsAt: STARTS_AT.toISOString(),
    });
    expect(noShow).toMatchObject({
      purpose: 'appointment_no_show_check',
      fireAt: '2026-08-05T14:30:00.000Z',
    });
    expect(noShow.payload).toMatchObject({
      kind: 'appointment_no_show_check',
      expectedCheckAt: '2026-08-05T14:30:00.000Z',
    });
  });

  it('reconciles clocks after an appointment update', async () => {
    const { scheduler, service } = harness();

    await service.observeDelivery(
      delivery('leadflow.calendar.appointment.updated'),
    );

    expect(scheduler.schedule).toHaveBeenCalledTimes(2);
  });

  it('does not schedule a terminal or missing appointment', async () => {
    const terminal = harness({
      id: APPOINTMENT,
      type: 'meeting',
      startAt: STARTS_AT,
      endAt: END_AT,
      metadata: { appointmentStatus: 'completed' },
    });
    await terminal.service.observeDelivery(delivery());
    expect(terminal.scheduler.schedule).not.toHaveBeenCalled();

    const missing = harness(null);
    await missing.service.observeDelivery(delivery());
    expect(missing.scheduler.schedule).not.toHaveBeenCalled();
  });

  it('does not duplicate a confirmation window already due at event time', async () => {
    const { scheduler, service } = harness({
      id: APPOINTMENT,
      type: 'meeting',
      status: 'scheduled',
      startAt: STARTS_AT,
      endAt: END_AT,
      dueAt: null,
      metadata: {
        appointmentStatus: 'pending',
        confirmationDueAt: '2026-08-01T11:00:00.000Z',
      },
    });

    await service.observeDelivery(delivery());

    expect(
      scheduler.schedule.mock.calls.map(([request]) => request.purpose),
    ).toEqual(['appointment_no_show_check']);
  });
});
