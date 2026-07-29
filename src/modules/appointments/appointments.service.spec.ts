import type { DataSource, EntityManager, Repository } from 'typeorm';
import { InboxDomainOutboxEntity } from '../inbox/entities/inbox-domain-outbox.entity';
import type { TeamChatMeetingsService } from '../team-chat/services/team-chat-meetings.service';
import { AppointmentsService } from './appointments.service';
import { ScheduledItemEntity } from './entities/scheduled-item.entity';
import { ScheduledItemParticipantEntity } from './entities/scheduled-item-participant.entity';
import { ScheduledItemReminderEntity } from './entities/scheduled-item-reminder.entity';

type StoredEntity = { id: string; createdAt?: Date; updatedAt?: Date };

function createRepository<T extends StoredEntity>(rows: T[]) {
  let sequence = 0;
  return {
    create: jest.fn((value: T) => value),
    save: jest.fn((value: T) => {
      const now = new Date();
      value.id ||= `90000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
      value.createdAt ??= now;
      value.updatedAt = now;
      const index = rows.findIndex((row) => row.id === value.id);
      if (index >= 0) rows[index] = value;
      else rows.push(value);
      return Promise.resolve(value);
    }),
    findOne: jest.fn(({ where }: { where: { id?: string } }) =>
      Promise.resolve(
        rows.find((row) => !where.id || row.id === where.id) ?? null,
      ),
    ),
    find: jest.fn(() => Promise.resolve(rows)),
  } as unknown as Repository<T>;
}

describe('AppointmentsService', () => {
  const ctx = {
    tenantId: '10000000-0000-4000-8000-000000000001',
    workspaceId: '20000000-0000-4000-8000-000000000002',
    userId: '30000000-0000-4000-8000-000000000003',
  };

  let items: ScheduledItemEntity[];
  let participants: ScheduledItemParticipantEntity[];
  let reminders: ScheduledItemReminderEntity[];
  let outbox: InboxDomainOutboxEntity[];
  let service: AppointmentsService;
  let meetings: jest.Mocked<
    Pick<
      TeamChatMeetingsService,
      | 'createForAppointment'
      | 'syncAppointmentBinding'
      | 'detachAppointmentBinding'
    >
  >;

  beforeEach(() => {
    items = [];
    participants = [];
    reminders = [];
    outbox = [];
    const itemRepository = createRepository(items);
    const participantRepository = createRepository(participants);
    const reminderRepository = createRepository(reminders);
    const outboxRepository = createRepository(outbox);
    const manager = {
      getRepository: jest.fn((entity) => {
        if (entity === ScheduledItemEntity) return itemRepository;
        if (entity === ScheduledItemParticipantEntity) {
          return participantRepository;
        }
        if (entity === ScheduledItemReminderEntity) return reminderRepository;
        if (entity === InboxDomainOutboxEntity) return outboxRepository;
        throw new Error(`Unexpected repository: ${String(entity)}`);
      }),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(
        (callback: (transactionManager: EntityManager) => unknown) =>
          Promise.resolve(callback(manager)),
      ),
    } as unknown as DataSource;
    meetings = {
      createForAppointment: jest.fn<
        ReturnType<TeamChatMeetingsService['createForAppointment']>,
        Parameters<TeamChatMeetingsService['createForAppointment']>
      >(() =>
        Promise.resolve({
          meetingRoomId: '40000000-0000-4000-8000-000000000004',
          publicUrl: '/meet/leadflow-room',
          providerRoomName: 'agency-workspace-room',
        }),
      ),
      syncAppointmentBinding: jest.fn<
        ReturnType<TeamChatMeetingsService['syncAppointmentBinding']>,
        Parameters<TeamChatMeetingsService['syncAppointmentBinding']>
      >(() =>
        Promise.resolve({
          meetingRoomId: '40000000-0000-4000-8000-000000000004',
          publicUrl: '/meet/leadflow-room',
          providerRoomName: 'agency-workspace-room',
        }),
      ),
      detachAppointmentBinding: jest.fn<
        ReturnType<TeamChatMeetingsService['detachAppointmentBinding']>,
        Parameters<TeamChatMeetingsService['detachAppointmentBinding']>
      >(() => Promise.resolve()),
    };
    service = new AppointmentsService(
      dataSource,
      itemRepository,
      participantRepository,
      reminderRepository,
      meetings as unknown as TeamChatMeetingsService,
    );
  });

  it('creates a pending native-video appointment, room and outbox events atomically', async () => {
    const result = await service.createScheduledItem(ctx, {
      type: 'meeting',
      title: 'Diagnóstico',
      startAt: '2026-08-01T13:00:00.000Z',
      endAt: '2026-08-01T14:00:00.000Z',
      locationType: 'video',
      videoMode: 'native',
      metadata: { appointmentStatus: 'pending' },
    });

    expect(result.videoUrl).toBe('/meet/leadflow-room');
    expect(result.metadata).toMatchObject({
      appointmentStatus: 'pending',
      meetingRoomId: '40000000-0000-4000-8000-000000000004',
      meetingProvider: 'livekit',
    });
    expect(meetings.createForAppointment).toHaveBeenCalledTimes(1);
    expect(outbox.map((event) => event.eventName)).toEqual([
      'leadflow.calendar.appointment.created',
      'leadflow.calendar.appointment.confirmation_pending',
    ]);
  });

  it('maps no-show to the legacy missed storage status and emits the canonical event once', async () => {
    const item = Object.assign(new ScheduledItemEntity(), {
      id: '50000000-0000-4000-8000-000000000005',
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      type: 'meeting',
      status: 'scheduled',
      title: 'Reunião',
      description: null,
      startAt: new Date('2026-08-02T13:00:00.000Z'),
      dueAt: null,
      locationType: 'video',
      videoMode: 'native',
      videoUrl: '/meet/leadflow-room',
      sourceChannel: 'manual',
      metadata: {
        appointmentStatus: 'confirmed',
        meetingRoomId: '40000000-0000-4000-8000-000000000004',
      },
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      updatedAt: new Date('2026-07-28T12:00:00.000Z'),
      deletedAt: null,
    });
    items.push(item);

    const result = await service.patchAppointmentLifecycleStatus(ctx, item.id, {
      status: 'no_show',
      reason: 'operator_marked',
    });

    expect(result.status).toBe('missed');
    expect(result.metadata.appointmentStatus).toBe('no_show');
    expect(meetings.syncAppointmentBinding).toHaveBeenCalledWith(
      expect.anything(),
      '40000000-0000-4000-8000-000000000004',
      expect.objectContaining({ lifecycleStatus: 'no_show' }),
      expect.anything(),
    );
    expect(outbox.map((event) => event.eventName)).toEqual([
      'leadflow.calendar.appointment.updated',
      'leadflow.calendar.appointment.no_show',
    ]);

    await service.patchAppointmentLifecycleStatus(ctx, item.id, {
      status: 'no_show',
    });
    expect(outbox).toHaveLength(2);
  });

  it.each([
    ['confirmed', 'scheduled', 'leadflow.calendar.appointment.confirmed'],
    ['canceled', 'canceled', 'leadflow.calendar.appointment.cancelled'],
    ['completed', 'completed', 'leadflow.calendar.appointment.completed'],
  ] as const)(
    'persists lifecycle %s and emits its canonical event',
    async (lifecycleStatus, storageStatus, eventName) => {
      const item = Object.assign(new ScheduledItemEntity(), {
        id: `60000000-0000-4000-8000-00000000000${outbox.length}`,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        type: 'meeting',
        status: 'scheduled',
        title: 'Reunião',
        description: null,
        startAt: new Date('2026-08-03T13:00:00.000Z'),
        dueAt: null,
        locationType: 'physical',
        videoMode: null,
        videoUrl: null,
        sourceChannel: 'manual',
        metadata: { appointmentStatus: 'pending' },
        createdAt: new Date('2026-07-28T12:00:00.000Z'),
        updatedAt: new Date('2026-07-28T12:00:00.000Z'),
        deletedAt: null,
      });
      items.push(item);

      const result = await service.patchAppointmentLifecycleStatus(
        ctx,
        item.id,
        { status: lifecycleStatus },
      );

      expect(result.status).toBe(storageStatus);
      expect(outbox.map((event) => event.eventName)).toEqual([
        'leadflow.calendar.appointment.updated',
        eventName,
      ]);
    },
  );

  it('detaches the LiveKit room when an appointment changes modality', async () => {
    const item = Object.assign(new ScheduledItemEntity(), {
      id: '70000000-0000-4000-8000-000000000007',
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      type: 'meeting',
      status: 'scheduled',
      title: 'Reunião externa',
      description: null,
      startAt: new Date('2026-08-04T13:00:00.000Z'),
      dueAt: null,
      locationType: 'video',
      videoMode: 'native',
      videoUrl: '/meet/leadflow-room',
      sourceChannel: 'manual',
      metadata: {
        appointmentStatus: 'confirmed',
        meetingRoomId: '40000000-0000-4000-8000-000000000004',
        meetingProvider: 'livekit',
      },
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      updatedAt: new Date('2026-07-28T12:00:00.000Z'),
      deletedAt: null,
    });
    items.push(item);

    const result = await service.patchScheduledItem(ctx, item.id, {
      locationType: 'video',
      videoMode: 'external_url',
      videoUrl: 'https://meet.example.com/external',
    });

    expect(meetings.detachAppointmentBinding).toHaveBeenCalledTimes(1);
    expect(result.videoUrl).toBe('https://meet.example.com/external');
    expect(result.metadata).not.toHaveProperty('meetingRoomId');
  });
});
