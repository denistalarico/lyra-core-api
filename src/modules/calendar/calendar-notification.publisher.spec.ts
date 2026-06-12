import { Logger } from '@nestjs/common';
import {
  NotificationInterestReason,
  NotificationProductKey,
} from '../notifications/enums';
import { NotificationEventProcessorService } from '../notifications/services';
import { CalendarNotificationPublisher } from './calendar-notification.publisher';
import { CalendarEvent } from './entities/calendar-event.entity';

describe('CalendarNotificationPublisher', () => {
  const processor = {
    process: jest.fn(),
  } as unknown as jest.Mocked<NotificationEventProcessorService>;

  beforeEach(() => {
    jest.clearAllMocks();
    processor.process.mockResolvedValue({
      status: 'created',
      notificationId: 'notification-1',
      recipientCount: 1,
    });
  });

  it('keeps publishInvitationReceived prepared for real participant userIds', async () => {
    const publisher = new CalendarNotificationPublisher(processor);
    const event = makeEvent();

    await publisher.publishInvitationReceived({
      event,
      actorUserId: 'user-owner',
      participantUserIds: ['user-participant', null, ''],
    });

    expect(expectProcessedEvent(processor)).toEqual(
      expect.objectContaining({
        eventId: expect.stringContaining('calendar.event_invitation_received'),
        eventType: 'calendar.event_invitation_received',
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'calendar',
        actorUserId: 'user-owner',
        resourceType: 'calendar_event',
        resourceId: event.id,
        recipients: [
          {
            userId: 'user-participant',
            interestReason: NotificationInterestReason.PARTICIPANT,
          },
        ],
        payload: expect.objectContaining({
          actionUrl: '/calendar',
          eventId: event.id,
        }),
      }),
    );
  });

  it('publishes event_updated to owner recipients', async () => {
    const publisher = new CalendarNotificationPublisher(processor);
    const event = makeEvent();

    await publisher.publishEventUpdated({
      event,
      actorUserId: 'user-actor',
      recipientUserIds: ['user-owner'],
    });

    const processed = expectProcessedEvent(processor);
    expect(processed).toEqual(
      expect.objectContaining({
        eventId: expect.stringContaining('calendar.event_updated'),
        eventType: 'calendar.event_updated',
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'calendar',
        resourceType: 'calendar_event',
        resourceId: event.id,
        recipients: [
          {
            userId: 'user-owner',
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
        payload: expect.objectContaining({
          actionUrl: '/calendar',
          body: `O evento "${event.title}" foi atualizado.`,
        }),
      }),
    );
    expect(processed.eventId).toContain(event.updatedAt.toISOString());
  });

  it('publishes event_rescheduled to owner recipients', async () => {
    const publisher = new CalendarNotificationPublisher(processor);
    const event = makeEvent();

    await publisher.publishEventRescheduled({
      event,
      actorUserId: 'user-actor',
      recipientUserIds: ['user-owner'],
    });

    expect(expectProcessedEvent(processor)).toEqual(
      expect.objectContaining({
        eventType: 'calendar.event_rescheduled',
        recipients: [
          {
            userId: 'user-owner',
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
        payload: expect.objectContaining({
          body: `O evento "${event.title}" foi reagendado.`,
        }),
      }),
    );
  });

  it('publishes event_canceled to owner recipients', async () => {
    const publisher = new CalendarNotificationPublisher(processor);
    const event = makeEvent();

    await publisher.publishEventCanceled({
      event,
      actorUserId: 'user-actor',
      recipientUserIds: ['user-owner'],
    });

    expect(expectProcessedEvent(processor)).toEqual(
      expect.objectContaining({
        eventType: 'calendar.event_canceled',
        recipients: [
          {
            userId: 'user-owner',
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
        payload: expect.objectContaining({
          body: `O evento "${event.title}" foi cancelado.`,
        }),
      }),
    );
  });

  it('keeps attendee_response_received prepared for future attendee response flows', async () => {
    const publisher = new CalendarNotificationPublisher(processor);
    const event = makeEvent();

    await publisher.publishAttendeeResponseReceived({
      event,
      actorUserId: 'user-attendee',
      attendeeUserId: 'user-attendee',
      attendeeName: 'Ana Silva',
      response: 'accepted',
      ownerUserId: 'user-owner',
    });

    expect(expectProcessedEvent(processor)).toEqual(
      expect.objectContaining({
        eventType: 'calendar.attendee_response_received',
        recipients: [
          {
            userId: 'user-owner',
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
        payload: expect.objectContaining({
          attendeeUserId: 'user-attendee',
          response: 'accepted',
        }),
      }),
    );
  });

  it('removes empty, actor, and duplicate recipients', async () => {
    const publisher = new CalendarNotificationPublisher(processor);

    await publisher.publishEventUpdated({
      event: makeEvent(),
      actorUserId: 'user-actor',
      recipientUserIds: [
        '',
        null,
        'user-actor',
        'user-owner',
        'user-owner',
      ],
    });

    expect(expectProcessedEvent(processor).recipients).toEqual([
      {
        userId: 'user-owner',
        interestReason: NotificationInterestReason.OWNER,
      },
    ]);
  });

  it('skips processing when no recipients remain', async () => {
    const publisher = new CalendarNotificationPublisher(processor);

    await publisher.publishEventUpdated({
      event: makeEvent(),
      actorUserId: 'user-actor',
      recipientUserIds: ['', null, 'user-actor'],
    });

    expect(processor.process).not.toHaveBeenCalled();
  });

  it('captures processor errors without rethrowing', async () => {
    const publisher = new CalendarNotificationPublisher(processor);
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    processor.process.mockRejectedValueOnce(new Error('processor failed'));

    await expect(
      publisher.publishEventUpdated({
        event: makeEvent(),
        actorUserId: 'user-actor',
        recipientUserIds: ['user-owner'],
      }),
    ).resolves.toBeUndefined();

    expect(processor.process).toHaveBeenCalledTimes(1);
    loggerSpy.mockRestore();
  });

  it('uses different deterministic ids for different calendar actions', async () => {
    const publisher = new CalendarNotificationPublisher(processor);
    const event = makeEvent();
    const randomSpy = jest.spyOn(Math, 'random');

    await publisher.publishEventUpdated({
      event,
      actorUserId: 'user-actor',
      recipientUserIds: ['user-owner'],
    });
    await publisher.publishEventRescheduled({
      event,
      actorUserId: 'user-actor',
      recipientUserIds: ['user-owner'],
    });
    await publisher.publishEventCanceled({
      event,
      actorUserId: 'user-actor',
      recipientUserIds: ['user-owner'],
    });

    const eventIds = processor.process.mock.calls.map(
      ([processed]) => processed.eventId,
    );

    expect(new Set(eventIds).size).toBe(3);
    for (const [index, eventId] of eventIds.entries()) {
      expect(eventId).toContain(
        [
          'calendar.event_updated',
          'calendar.event_rescheduled',
          'calendar.event_canceled',
        ][index],
      );
      expect(eventId).toContain(event.id);
      expect(eventId).toContain(event.updatedAt.toISOString());
    }
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });
});

function expectProcessedEvent(processor: jest.Mocked<NotificationEventProcessorService>) {
  expect(processor.process).toHaveBeenCalledTimes(1);
  return processor.process.mock.calls[0][0];
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'event-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    title: 'Reunião de kickoff',
    description: null,
    eventType: 'internal_meeting',
    status: 'scheduled',
    visibility: 'workspace',
    startsAt: new Date('2026-06-13T12:00:00.000Z'),
    endsAt: new Date('2026-06-13T13:00:00.000Z'),
    allDay: false,
    ownerUserId: 'user-owner',
    createdByUserId: 'user-owner',
    clientId: null,
    projectId: null,
    taskId: null,
    salesOpportunityId: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}
