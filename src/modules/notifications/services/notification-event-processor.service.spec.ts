import { DataSource } from 'typeorm';
import {
  NotificationActionType,
  NotificationActorType,
  NotificationCategory,
  NotificationDeliveryChannel,
  NotificationDeliveryStatus,
  NotificationInterestReason,
  NotificationPreferencePolicy,
  NotificationPriority,
  NotificationProductKey,
  NotificationRecipientStrategy,
  NotificationSelfPolicy,
  NotificationDefaultDelivery,
} from '../enums';
import { NotificationEventProcessorService } from './notification-event-processor.service';
import { NotificationRealtimeService } from './notification-realtime.service';

describe('NotificationEventProcessorService realtime', () => {
  it('emits realtime after notification recipients and deliveries are created', async () => {
    const { service, realtime, repos } = makeService();

    const result = await service.process(makeEvent());

    expect(result).toEqual({
      status: 'created',
      notificationId: 'notification-1',
      recipientCount: 2,
    });
    expect(repos.delivery.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          channel: NotificationDeliveryChannel.IN_APP,
          status: NotificationDeliveryStatus.SENT,
        }),
      ]),
    );
    expect(realtime.emitCreatedForRecipient).toHaveBeenCalledTimes(2);
    expect(realtime.emitCreatedForRecipient).toHaveBeenNthCalledWith(
      1,
      'recipient-1',
    );
    expect(realtime.emitCreatedForRecipient).toHaveBeenNthCalledWith(
      2,
      'recipient-2',
    );
  });

  it('does not emit realtime for duplicate events', async () => {
    const { service, realtime } = makeService({
      existingNotification: {
        id: 'notification-existing',
        recipients: [{ id: 'recipient-existing' }],
      },
    });

    const result = await service.process(makeEvent());

    expect(result).toEqual({
      status: 'duplicate',
      notificationId: 'notification-existing',
      recipientCount: 1,
    });
    expect(realtime.emitCreatedForRecipient).not.toHaveBeenCalled();
  });

  it('does not emit realtime when there are no recipients', async () => {
    const { service, realtime } = makeService({
      resolvedRecipients: [],
    });

    const result = await service.process(makeEvent());

    expect(result).toEqual({
      status: 'skipped',
      reason: 'no_recipients',
      recipientCount: 0,
    });
    expect(realtime.emitCreatedForRecipient).not.toHaveBeenCalled();
  });

  it('does not fail processing when realtime emission fails', async () => {
    const { service, realtime } = makeService();
    realtime.emitCreatedForRecipient.mockRejectedValueOnce(
      new Error('socket unavailable'),
    );

    const result = await service.process(makeEvent());

    expect(result.status).toBe('created');
  });

  it('records Web Push as skipped when the user has no usable subscription', async () => {
    const { service, repos } = makeService({
      preferenceRows: [
        {
          userId: 'user-1',
          preferences: [{ key: 'tasks', push: true }],
        },
        {
          userId: 'user-2',
          preferences: [{ key: 'tasks', push: true }],
        },
      ],
      pushOutcomes: new Map([
        ['user-1', 'unavailable'],
        ['user-2', 'unavailable'],
      ]),
    });

    await service.process(makeEvent());

    expect(repos.delivery.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: NotificationDeliveryStatus.SKIPPED,
        failureReason: 'skipped_web_push_unavailable',
        attempts: 0,
      }),
    );
  });
});

function makeService(
  options: {
    existingNotification?: Record<string, unknown> | null;
    resolvedRecipients?: Array<{
      userId: string;
      interestReason: NotificationInterestReason;
    }>;
    preferenceRows?: Array<Record<string, unknown>>;
    pushOutcomes?: Map<string, string>;
  } = {},
) {
  const repos = makeRepositories(options.existingNotification ?? null);
  const dataSource = {
    transaction: jest.fn(async (callback) =>
      callback({
        getRepository: (entity: { name: string }) => {
          if (entity.name === 'NotificationEntity') return repos.notification;
          if (entity.name === 'NotificationRecipientEntity')
            return repos.recipient;
          if (entity.name === 'NotificationDeliveryEntity')
            return repos.delivery;
          throw new Error(`Unexpected repository ${entity.name}`);
        },
      }),
    ),
    getRepository: jest.fn(() => repos.delivery),
  } as unknown as DataSource;
  const catalog = {
    requireDefinition: jest.fn(() => makeDefinition()),
  };
  const recipientResolver = {
    resolve: jest.fn(
      () =>
        options.resolvedRecipients ?? [
          {
            userId: 'user-1',
            interestReason: NotificationInterestReason.ASSIGNED,
          },
          {
            userId: 'user-2',
            interestReason: NotificationInterestReason.MANAGER,
          },
        ],
    ),
  };
  const selfNotificationPolicy = {
    apply: jest.fn((_event, recipients) => recipients),
  };
  const realtime = {
    emitCreatedForRecipient: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<NotificationRealtimeService>;
  const preferencesRepo = {
    find: jest.fn().mockResolvedValue(options.preferenceRows ?? []),
  };
  const workspaceUsersRepo = { find: jest.fn().mockResolvedValue([]) };
  const emailSettingsRepo = { findOne: jest.fn().mockResolvedValue(null) };
  const emailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const cryptoService = { decrypt: jest.fn() };
  const configService = { get: jest.fn() };
  const pushService = {
    sendToUsers: jest.fn().mockResolvedValue(options.pushOutcomes ?? new Map()),
  };
  const service = new NotificationEventProcessorService(
    dataSource,
    preferencesRepo as never,
    workspaceUsersRepo as never,
    emailSettingsRepo as never,
    catalog as never,
    recipientResolver as never,
    selfNotificationPolicy as never,
    realtime,
    emailService as never,
    cryptoService as never,
    configService as never,
    pushService as never,
  );

  return { service, realtime, repos };
}

function makeRepositories(
  existingNotification: Record<string, unknown> | null,
) {
  const notification = {
    findOne: jest.fn().mockResolvedValue(existingNotification),
    create: jest.fn((input) => input),
    save: jest.fn(async (input) => ({
      ...input,
      id: 'notification-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })),
  };
  const recipient = {
    create: jest.fn((input) => input),
    save: jest.fn(async (inputs) =>
      inputs.map((input: Record<string, unknown>, index: number) => ({
        ...input,
        id: `recipient-${index + 1}`,
      })),
    ),
  };
  const delivery = {
    create: jest.fn((input) => input),
    save: jest.fn(async (inputs) =>
      inputs.map((input: Record<string, unknown>, index: number) => ({
        ...input,
        id: `delivery-${index + 1}`,
      })),
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  return { notification, recipient, delivery };
}

function makeDefinition() {
  return {
    eventType: 'task.assigned',
    productKey: NotificationProductKey.AGENCY,
    moduleKey: 'tasks',
    category: NotificationCategory.ASSIGNMENT,
    defaultPriority: NotificationPriority.NORMAL,
    defaultActionType: NotificationActionType.INTERNAL_ROUTE,
    recipientStrategy: NotificationRecipientStrategy.EXPLICIT_USERS,
    selfNotificationPolicy: NotificationSelfPolicy.ALLOW_ACTOR,
    preferencePolicy: NotificationPreferencePolicy.CONFIGURABLE,
    preferenceKey: 'agency.tasks.assignment',
    defaultDelivery: NotificationDefaultDelivery.ENABLED,
    required: false,
    groupable: false,
  };
}

function makeEvent() {
  return {
    eventId: 'event-1',
    eventType: 'task.assigned',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    productKey: NotificationProductKey.AGENCY,
    moduleKey: 'tasks',
    actorType: NotificationActorType.USER,
    actorUserId: 'actor-1',
    resourceType: 'task',
    resourceId: '00000000-0000-0000-0000-000000000001',
    occurredAt: '2026-01-01T00:00:00.000Z',
    payload: {
      title: 'Task assigned',
      body: 'Please check the task.',
      actionUrl: '/tasks/1',
    },
  };
}
