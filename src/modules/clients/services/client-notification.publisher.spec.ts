import { Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { AgencyClient } from '../entities';
import {
  AgencyClientHealthStatus,
  AgencyClientLifecycleStage,
  AgencyClientStatus,
} from '../enums';
import { ClientNotificationPublisher } from './client-notification.publisher';

describe('ClientNotificationPublisher', () => {
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

  it('publishes client.assigned to the account owner with the client route', async () => {
    const publisher = new ClientNotificationPublisher(processor);
    const client = makeClient({ accountOwnerId: 'user-owner' });

    await publisher.publishAssigned({ client, actorUserId: 'user-actor' });

    const event = expectProcessedEvent(processor);
    expect(event).toEqual(
      expect.objectContaining({
        eventType: 'client.assigned',
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'clients',
        actorType: NotificationActorType.USER,
        actorUserId: 'user-actor',
        resourceType: 'client',
        resourceId: client.id,
        recipients: [
          { userId: 'user-owner', interestReason: NotificationInterestReason.ASSIGNED },
        ],
        payload: expect.objectContaining({
          actionUrl: `/clients/${client.id}`,
          clientId: client.id,
        }),
      }),
    );
  });

  it('publishes client.owner_changed with previousOwnerId in the eventId', async () => {
    const publisher = new ClientNotificationPublisher(processor);
    const client = makeClient({ accountOwnerId: 'user-new-owner' });

    await publisher.publishOwnerChanged({
      client,
      actorUserId: 'user-actor',
      previousOwnerId: 'user-old-owner',
    });

    const event = expectProcessedEvent(processor);
    expect(event.eventType).toBe('client.owner_changed');
    expect(event.eventId).toContain('user-old-owner');
    expect(event.eventId).toContain('user-new-owner');
    expect(event.recipients).toEqual([
      { userId: 'user-new-owner', interestReason: NotificationInterestReason.OWNER },
    ]);
  });

  it('publishes client.onboarding_started and client.onboarding_completed to the owner', async () => {
    const publisher = new ClientNotificationPublisher(processor);
    const client = makeClient({
      accountOwnerId: 'user-owner',
      lifecycleStage: AgencyClientLifecycleStage.Onboarding,
    });

    await publisher.publishOnboardingStarted({ client, actorUserId: 'user-actor' });
    expect(expectProcessedEvent(processor).eventType).toBe('client.onboarding_started');

    jest.clearAllMocks();
    processor.process.mockResolvedValue({
      status: 'created',
      notificationId: 'notification-2',
      recipientCount: 1,
    });

    await publisher.publishOnboardingCompleted({
      client: makeClient({
        accountOwnerId: 'user-owner',
        lifecycleStage: AgencyClientLifecycleStage.Active,
      }),
      actorUserId: 'user-actor',
    });
    expect(expectProcessedEvent(processor).eventType).toBe('client.onboarding_completed');
  });

  it('publishes client.managed_tenant_connected and client.managed_tenant_disconnected', async () => {
    const publisher = new ClientNotificationPublisher(processor);
    const connected = makeClient({
      accountOwnerId: 'user-owner',
      managedTenantId: 'managed-tenant-1',
    });

    await publisher.publishManagedTenantConnected({ client: connected, actorUserId: 'user-actor' });
    expect(expectProcessedEvent(processor).eventType).toBe('client.managed_tenant_connected');

    jest.clearAllMocks();
    processor.process.mockResolvedValue({
      status: 'created',
      notificationId: 'notification-2',
      recipientCount: 1,
    });

    const disconnected = makeClient({ accountOwnerId: 'user-owner', managedTenantId: null });

    await publisher.publishManagedTenantDisconnected({
      client: disconnected,
      actorUserId: 'user-actor',
      previousManagedTenantId: 'managed-tenant-1',
    });

    const event = expectProcessedEvent(processor);
    expect(event.eventType).toBe('client.managed_tenant_disconnected');
    expect(event.eventId).toContain('managed-tenant-1');
  });

  it('removes empty, duplicate, and actor recipients', async () => {
    const publisher = new ClientNotificationPublisher(processor);
    const client = makeClient({ accountOwnerId: 'user-actor' });

    await publisher.publishAssigned({
      client,
      actorUserId: 'user-actor',
      recipients: [
        { userId: '', interestReason: NotificationInterestReason.ASSIGNED },
        { userId: 'user-actor', interestReason: NotificationInterestReason.ASSIGNED },
        { userId: 'user-owner', interestReason: NotificationInterestReason.ASSIGNED },
        { userId: 'user-owner', interestReason: NotificationInterestReason.OWNER },
      ],
    });

    expect(expectProcessedEvent(processor).recipients).toEqual([
      { userId: 'user-owner', interestReason: NotificationInterestReason.ASSIGNED },
    ]);
  });

  it('does not call the processor when there is no account owner', async () => {
    const publisher = new ClientNotificationPublisher(processor);
    const client = makeClient({ accountOwnerId: null });

    await publisher.publishAssigned({ client, actorUserId: 'user-actor' });

    expect(processor.process).not.toHaveBeenCalled();
  });

  it('captures processor errors without rethrowing', async () => {
    const publisher = new ClientNotificationPublisher(processor);
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    processor.process.mockRejectedValueOnce(new Error('processor failed'));

    const client = makeClient({ accountOwnerId: 'user-owner' });

    await expect(
      publisher.publishAssigned({ client, actorUserId: 'user-actor' }),
    ).resolves.toBeUndefined();

    expect(processor.process).toHaveBeenCalledTimes(1);
    loggerSpy.mockRestore();
  });
});

function expectProcessedEvent(
  processor: jest.Mocked<NotificationEventProcessorService>,
) {
  expect(processor.process).toHaveBeenCalledTimes(1);
  return processor.process.mock.calls[0][0];
}

function makeClient(overrides: Partial<AgencyClient> = {}): AgencyClient {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'client-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    contactId: null,
    displayName: 'Acme Corp',
    legalName: null,
    status: AgencyClientStatus.Active,
    lifecycleStage: AgencyClientLifecycleStage.Active,
    healthStatus: AgencyClientHealthStatus.Healthy,
    segment: null,
    accountOwnerId: null,
    managedTenantId: null,
    startDate: null,
    endDate: null,
    notes: null,
    metadata: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
