import { Repository } from 'typeorm';
import { NotificationEventProcessorService } from '../notifications/services';
import { CalendarNotificationPublisher } from './calendar-notification.publisher';
import { CalendarService } from './calendar.service';
import { CalendarEvent } from './entities/calendar-event.entity';
import { CalendarRoutineBlock } from './entities/calendar-routine-block.entity';
import { CalendarSettings } from './entities/calendar-settings.entity';

describe('CalendarService notification triggers', () => {
  it('scopes member calendar lists to owned or created events', async () => {
    const { service, queryBuilder } = makeService();

    await service.listEvents(
      { ...makeContext(), role: 'member' },
      {
        startsAt: '2030-06-13T00:00:00.000Z',
        endsAt: '2030-06-14T00:00:00.000Z',
      },
    );

    expect(queryBuilder.scopeClauses.join('\n')).toContain(
      'event.owner_user_id = :scopeUserId',
    );
    expect(queryBuilder.scopeClauses.join('\n')).toContain(
      'event.created_by_user_id = :scopeUserId',
    );
  });

  it('does not publish invitation when creating an event with ownerUserId', async () => {
    const { service, publisher } = makeService();

    await service.createEvent(makeContext(), {
      title: 'Reunião de kickoff',
      startsAt: '2030-06-13T12:00:00.000Z',
      endsAt: '2030-06-13T13:00:00.000Z',
      ownerUserId: 'user-owner',
    });

    expect(publisher.publishInvitationReceived).not.toHaveBeenCalled();
  });

  it('does not publish invitation when ownerUserId changes', async () => {
    const event = makeEvent({ ownerUserId: 'user-old-owner' });
    const { service, publisher } = makeService({ event });

    await service.updateEvent(makeContext(), event.id, {
      ownerUserId: 'user-new-owner',
    });

    expect(publisher.publishInvitationReceived).not.toHaveBeenCalled();
  });

  it('publishes updated for relevant non-time changes', async () => {
    const event = makeEvent();
    const { service, publisher } = makeService({ event });

    await service.updateEvent(makeContext(), event.id, {
      title: 'Reunião de kickoff atualizada',
    });

    expect(publisher.publishEventUpdated).toHaveBeenCalledTimes(1);
    expect(publisher.publishEventUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          title: 'Reunião de kickoff atualizada',
        }),
        recipientUserIds: ['user-owner'],
      }),
    );
  });

  it('publishes rescheduled, not updated, when event time changes', async () => {
    const event = makeEvent();
    const { service, publisher } = makeService({ event });

    await service.updateEvent(makeContext(), event.id, {
      startsAt: '2030-06-13T14:00:00.000Z',
      endsAt: '2030-06-13T15:00:00.000Z',
    });

    expect(publisher.publishEventRescheduled).toHaveBeenCalledTimes(1);
    expect(publisher.publishEventUpdated).not.toHaveBeenCalled();
  });

  it('keeps rescheduled precedence when time and title change together', async () => {
    const event = makeEvent();
    const { service, publisher } = makeService({ event });

    await service.updateEvent(makeContext(), event.id, {
      title: 'Reunião de kickoff atualizada',
      startsAt: '2030-06-13T14:00:00.000Z',
      endsAt: '2030-06-13T15:00:00.000Z',
    });

    expect(publisher.publishEventRescheduled).toHaveBeenCalledTimes(1);
    expect(publisher.publishEventUpdated).not.toHaveBeenCalled();
  });

  it('does not publish when update has no relevant changes', async () => {
    const event = makeEvent();
    const { service, publisher } = makeService({ event });

    await service.updateEvent(makeContext(), event.id, {
      title: event.title,
      description: event.description ?? undefined,
    });

    expectNoCalendarNotifications(publisher);
  });

  it('publishes canceled after successful soft removal', async () => {
    const event = makeEvent();
    const { service, publisher, eventsRepository } = makeService({ event });

    await service.removeEvent(makeContext(), event.id);

    expect(eventsRepository.softRemove).toHaveBeenCalledWith(event);
    expect(publisher.publishEventCanceled).toHaveBeenCalledTimes(1);
    expect(publisher.publishEventCanceled).toHaveBeenCalledWith(
      expect.objectContaining({
        event,
        recipientUserIds: ['user-owner'],
      }),
    );
  });

  it('does not call updated, rescheduled, or canceled publishers when ownerUserId is empty', async () => {
    const updateEvent = makeEvent({ ownerUserId: null });
    const update = makeService({ event: updateEvent });

    await update.service.updateEvent(makeContext(), updateEvent.id, {
      title: 'Reunião sem owner atualizada',
    });

    expect(update.publisher.publishEventUpdated).not.toHaveBeenCalled();

    const rescheduleEvent = makeEvent({ ownerUserId: null });
    const reschedule = makeService({ event: rescheduleEvent });

    await reschedule.service.updateEvent(makeContext(), rescheduleEvent.id, {
      startsAt: '2030-06-13T14:00:00.000Z',
      endsAt: '2030-06-13T15:00:00.000Z',
    });

    expect(reschedule.publisher.publishEventRescheduled).not.toHaveBeenCalled();

    const cancelEvent = makeEvent({ ownerUserId: null });
    const cancel = makeService({ event: cancelEvent });

    await cancel.service.removeEvent(makeContext(), cancelEvent.id);

    expect(cancel.publisher.publishEventCanceled).not.toHaveBeenCalled();
  });

  it('does not persist a notification when actor is the owner', async () => {
    const processor = {
      process: jest.fn(),
    } as unknown as jest.Mocked<NotificationEventProcessorService>;
    const realPublisher = new CalendarNotificationPublisher(processor);
    const event = makeEvent({ ownerUserId: 'user-actor' });
    const { service } = makeService({
      event,
      publisher: realPublisher as jest.Mocked<CalendarNotificationPublisher>,
    });

    await service.updateEvent(makeContext(), event.id, {
      title: 'Reunião atualizada pelo owner',
    });

    expect(processor.process).not.toHaveBeenCalled();
  });

  it('keeps update successful when the real publisher catches processor failures', async () => {
    const processor = {
      process: jest.fn().mockRejectedValue(new Error('processor failed')),
    } as unknown as jest.Mocked<NotificationEventProcessorService>;
    const realPublisher = new CalendarNotificationPublisher(processor);
    const loggerSpy = jest
      .spyOn((realPublisher as any).logger, 'error')
      .mockImplementation(() => undefined);
    const event = makeEvent({ ownerUserId: 'user-owner' });
    const { service, eventsRepository } = makeService({
      event,
      publisher: realPublisher as jest.Mocked<CalendarNotificationPublisher>,
    });

    const result = await service.updateEvent(makeContext(), event.id, {
      title: 'Reunião atualizada',
    });

    expect(result.title).toBe('Reunião atualizada');
    expect(eventsRepository.save).toHaveBeenCalledTimes(1);
    expect(processor.process).toHaveBeenCalledTimes(1);
    loggerSpy.mockRestore();
  });

  it('keeps remove successful when the real publisher catches processor failures', async () => {
    const processor = {
      process: jest.fn().mockRejectedValue(new Error('processor failed')),
    } as unknown as jest.Mocked<NotificationEventProcessorService>;
    const realPublisher = new CalendarNotificationPublisher(processor);
    const loggerSpy = jest
      .spyOn((realPublisher as any).logger, 'error')
      .mockImplementation(() => undefined);
    const event = makeEvent({ ownerUserId: 'user-owner' });
    const { service, eventsRepository } = makeService({
      event,
      publisher: realPublisher as jest.Mocked<CalendarNotificationPublisher>,
    });

    await expect(service.removeEvent(makeContext(), event.id)).resolves.toEqual(
      {
        success: true,
      },
    );
    expect(eventsRepository.softRemove).toHaveBeenCalledTimes(1);
    expect(processor.process).toHaveBeenCalledTimes(1);
    loggerSpy.mockRestore();
  });
});

function makeService(
  options: {
    event?: CalendarEvent;
    publisher?: jest.Mocked<CalendarNotificationPublisher>;
  } = {},
) {
  const event = options.event ?? makeEvent();
  const queryBuilder = createQueryBuilderMock<CalendarEvent>();
  const eventsRepository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
    create: jest.fn((value: Partial<CalendarEvent>) =>
      makeEvent({
        ...value,
        title: value.title ?? 'Reunião de kickoff',
        startsAt: value.startsAt ?? event.startsAt,
        endsAt: value.endsAt ?? event.endsAt,
        ownerUserId: value.ownerUserId ?? null,
      }),
    ),
    findOne: jest.fn().mockResolvedValue(event),
    save: jest.fn().mockImplementation(async (item: CalendarEvent) => item),
    softRemove: jest.fn().mockResolvedValue(event),
  };
  const publisher = options.publisher ?? makeCalendarPublisher();
  const emailService = {
    sendCalendarReminderEmail: jest.fn().mockResolvedValue(undefined),
  };
  const service = new CalendarService(
    eventsRepository as unknown as Repository<CalendarEvent>,
    {} as Repository<CalendarRoutineBlock>,
    {} as Repository<CalendarSettings>,
    publisher,
    emailService as any,
  );

  return {
    service,
    publisher,
    eventsRepository,
    queryBuilder,
  };
}

function createQueryBuilderMock<T>() {
  const scopeClauses: string[] = [];
  const bracketQb = {
    where: jest.fn((condition: string) => {
      scopeClauses.push(condition);
      return bracketQb;
    }),
    orWhere: jest.fn((condition: string) => {
      scopeClauses.push(condition);
      return bracketQb;
    }),
  };
  const qb = {
    scopeClauses,
    where: jest.fn(() => qb),
    andWhere: jest.fn((condition: unknown) => {
      if (
        condition &&
        typeof condition === 'object' &&
        'whereFactory' in condition &&
        typeof (condition as { whereFactory?: unknown }).whereFactory ===
          'function'
      ) {
        (
          condition as { whereFactory: (qb: typeof bracketQb) => void }
        ).whereFactory(bracketQb);
      } else if (typeof condition === 'string') {
        scopeClauses.push(condition);
      }
      return qb;
    }),
    orderBy: jest.fn(() => qb),
    getMany: jest.fn().mockResolvedValue([] as T[]),
  };

  return qb;
}

function makeCalendarPublisher() {
  return {
    publishInvitationReceived: jest.fn(),
    publishEventUpdated: jest.fn(),
    publishEventCanceled: jest.fn(),
    publishEventRescheduled: jest.fn(),
    publishEventReminder: jest.fn(),
    publishAttendeeResponseReceived: jest.fn(),
  } as unknown as jest.Mocked<CalendarNotificationPublisher>;
}

function expectNoCalendarNotifications(
  publisher: jest.Mocked<CalendarNotificationPublisher>,
) {
  expect(publisher.publishInvitationReceived).not.toHaveBeenCalled();
  expect(publisher.publishEventUpdated).not.toHaveBeenCalled();
  expect(publisher.publishEventCanceled).not.toHaveBeenCalled();
  expect(publisher.publishEventRescheduled).not.toHaveBeenCalled();
  expect(publisher.publishEventReminder).not.toHaveBeenCalled();
  expect(publisher.publishAttendeeResponseReceived).not.toHaveBeenCalled();
}

function makeContext() {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-actor',
  };
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const now = new Date('2030-06-12T12:00:00.000Z');

  return {
    id: 'event-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    title: 'Reunião de kickoff',
    description: null,
    eventType: 'internal_meeting',
    status: 'scheduled',
    visibility: 'workspace',
    startsAt: new Date('2030-06-13T12:00:00.000Z'),
    endsAt: new Date('2030-06-13T13:00:00.000Z'),
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
