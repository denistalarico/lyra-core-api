import { Repository } from 'typeorm';
import {
  NotificationActionType,
  NotificationActorType,
  NotificationCategory,
  NotificationDeliveryChannel,
  NotificationDeliveryStatus,
  NotificationInterestReason,
  NotificationPriority,
  NotificationProductKey,
} from '../enums';
import { NotificationRealtimeService } from './notification-realtime.service';
import { NotificationsService } from './notifications.service';

describe('NotificationRealtimeService', () => {
  it('uses tenant, workspace, and user in the notification room', () => {
    expect(
      NotificationRealtimeService.getUserRoom({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      }),
    ).toBe('notifications:tenant-1:workspace-1:user-1');
  });

  it('emits a safe list payload and unread count to the user room', async () => {
    const server = makeServer();
    const recipientRepo = {
      findOne: jest.fn().mockResolvedValue(makeRecipient()),
    } as unknown as jest.Mocked<Repository<never>>;
    const notificationsService = {
      unreadCount: jest.fn().mockResolvedValue({
        count: 7,
        byProduct: { agency: 7 },
      }),
    } as unknown as jest.Mocked<NotificationsService>;
    const service = new NotificationRealtimeService(
      recipientRepo as never,
      notificationsService,
    );

    service.bindServer(server as never);
    await service.emitCreatedForRecipient('recipient-1');

    expect(server.to).toHaveBeenCalledWith(
      'notifications:tenant-1:workspace-1:user-1',
    );
    expect(server.emit).toHaveBeenCalledWith(
      'notification.created',
      expect.objectContaining({
        unreadCount: 7,
        notification: expect.objectContaining({
          id: 'notification-1',
          recipientId: 'recipient-1',
          title: 'Task assigned',
          isRead: false,
        }),
      }),
    );
    const payload = server.emit.mock.calls[0][1];
    expect(payload.notification).not.toHaveProperty('templateVariables');
    expect(payload.notification).not.toHaveProperty('metadata');
    expect(payload.notification).not.toHaveProperty('sourceEventId');
  });

  it('does not emit when there is no sent in-app delivery', async () => {
    const server = makeServer();
    const recipient = makeRecipient();
    recipient.deliveries = [
      {
        channel: NotificationDeliveryChannel.EMAIL,
        status: NotificationDeliveryStatus.SENT,
      },
    ];
    const recipientRepo = {
      findOne: jest.fn().mockResolvedValue(recipient),
    } as unknown as jest.Mocked<Repository<never>>;
    const service = new NotificationRealtimeService(
      recipientRepo as never,
      { unreadCount: jest.fn() } as unknown as NotificationsService,
    );

    service.bindServer(server as never);
    await service.emitCreatedForRecipient('recipient-1');

    expect(server.emit).not.toHaveBeenCalled();
  });

  it('swallows realtime failures', async () => {
    const recipientRepo = {
      findOne: jest.fn().mockRejectedValue(new Error('db unavailable')),
    } as unknown as jest.Mocked<Repository<never>>;
    const service = new NotificationRealtimeService(
      recipientRepo as never,
      { unreadCount: jest.fn() } as unknown as NotificationsService,
    );

    service.bindServer(makeServer() as never);

    await expect(
      service.emitCreatedForRecipient('recipient-1'),
    ).resolves.toBeUndefined();
  });
});

function makeServer() {
  const server = {
    to: jest.fn(),
    emit: jest.fn(),
  };

  server.to.mockReturnValue(server);
  return server;
}

function makeRecipient() {
  return {
    id: 'recipient-1',
    notificationId: 'notification-1',
    userId: 'user-1',
    interestReason: NotificationInterestReason.ASSIGNED,
    seenAt: null,
    readAt: null,
    archivedAt: null,
    dismissedAt: null,
    createdAt: new Date('2026-01-01T00:00:01.000Z'),
    updatedAt: new Date('2026-01-01T00:00:01.000Z'),
    deliveries: [
      {
        channel: NotificationDeliveryChannel.IN_APP,
        status: NotificationDeliveryStatus.SENT,
      },
    ],
    notification: {
      id: 'notification-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      productKey: NotificationProductKey.AGENCY,
      moduleKey: 'tasks',
      eventType: 'task.assigned',
      category: NotificationCategory.ASSIGNMENT,
      priority: NotificationPriority.NORMAL,
      title: 'Task assigned',
      body: 'Please check the task.',
      actionType: NotificationActionType.INTERNAL_ROUTE,
      actionUrl: '/tasks/1',
      resourceType: 'task',
      resourceId: '00000000-0000-0000-0000-000000000001',
      actorType: NotificationActorType.USER,
      actorUserId: 'actor-1',
      initiatedByUserId: 'actor-1',
      sourceEventId: 'event-1',
      deduplicationKey: null,
      templateKey: 'notifications.task.assigned',
      templateVariables: { secret: 'do-not-send' },
      metadata: { internal: true },
      managedTenantId: null,
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  };
}
