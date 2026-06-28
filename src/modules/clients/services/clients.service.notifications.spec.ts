import { Repository } from 'typeorm';
import { AgencyActivity } from '../../activities/entities';
import { AgencyProject, AgencyTask } from '../../projects/entities';
import { AgencyClient } from '../entities';
import {
  AgencyClientHealthStatus,
  AgencyClientLifecycleStage,
  AgencyClientStatus,
} from '../enums';
import { ClientCostCenterService } from './client-cost-center.service';
import { ClientNotificationPublisher } from './client-notification.publisher';
import { ClientsProfitabilityService } from './clients-profitability.service';
import { ClientsService } from './clients.service';

describe('ClientsService notification triggers', () => {
  it('publishes client.assigned on create when an account owner is set', async () => {
    const { service, publisher } = makeService();

    await service.create(makeContext(), makeCreateDto({ accountOwnerId: 'user-owner' }));

    expect(publisher.publishAssigned).toHaveBeenCalledTimes(1);
    expect(publisher.publishOwnerChanged).not.toHaveBeenCalled();
  });

  it('auto-provisions a cost center on create', async () => {
    const { service, clientCostCenterService } = makeService();

    await service.create(makeContext(), makeCreateDto());

    expect(clientCostCenterService.ensureForClientSafe).toHaveBeenCalledTimes(1);
  });

  it('does not publish client.assigned on create without an account owner', async () => {
    const { service, publisher } = makeService();

    await service.create(makeContext(), makeCreateDto({ accountOwnerId: undefined }));

    expect(publisher.publishAssigned).not.toHaveBeenCalled();
  });

  it('publishes client.assigned on update when owner was previously unset', async () => {
    const client = makeClient({ accountOwnerId: null });
    const { service, publisher } = makeService({ client });

    await service.update(makeContext(), client.id, { accountOwnerId: 'user-owner' });

    expect(publisher.publishAssigned).toHaveBeenCalledTimes(1);
    expect(publisher.publishOwnerChanged).not.toHaveBeenCalled();
  });

  it('publishes client.owner_changed on update when owner changes from one user to another', async () => {
    const client = makeClient({ accountOwnerId: 'user-old-owner' });
    const { service, publisher } = makeService({ client });

    await service.update(makeContext(), client.id, { accountOwnerId: 'user-new-owner' });

    expect(publisher.publishOwnerChanged).toHaveBeenCalledWith(
      expect.objectContaining({ previousOwnerId: 'user-old-owner' }),
    );
    expect(publisher.publishAssigned).not.toHaveBeenCalled();
  });

  it('does not publish owner events when accountOwnerId is unchanged', async () => {
    const client = makeClient({ accountOwnerId: 'user-owner' });
    const { service, publisher } = makeService({ client });

    await service.update(makeContext(), client.id, { displayName: 'Updated name' });

    expect(publisher.publishAssigned).not.toHaveBeenCalled();
    expect(publisher.publishOwnerChanged).not.toHaveBeenCalled();
  });

  it('publishes managed_tenant_connected and managed_tenant_disconnected', async () => {
    const client = makeClient({ managedTenantId: null });
    const { service, publisher } = makeService({ client });

    await service.update(makeContext(), client.id, { managedTenantId: 'managed-tenant-1' });
    expect(publisher.publishManagedTenantConnected).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    const connectedClient = makeClient({ managedTenantId: 'managed-tenant-1' });
    const { service: service2, publisher: publisher2 } = makeService({ client: connectedClient });

    await service2.update(makeContext(), connectedClient.id, { managedTenantId: null });
    expect(publisher2.publishManagedTenantDisconnected).toHaveBeenCalledWith(
      expect.objectContaining({ previousManagedTenantId: 'managed-tenant-1' }),
    );
  });

  it('publishes onboarding_started and onboarding_completed on lifecycle stage transitions', async () => {
    const client = makeClient({ lifecycleStage: AgencyClientLifecycleStage.Active });
    const { service, publisher } = makeService({ client });

    await service.update(makeContext(), client.id, {
      lifecycleStage: AgencyClientLifecycleStage.Onboarding,
    });
    expect(publisher.publishOnboardingStarted).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    const onboardingClient = makeClient({ lifecycleStage: AgencyClientLifecycleStage.Onboarding });
    const { service: service2, publisher: publisher2 } = makeService({ client: onboardingClient });

    await service2.update(makeContext(), onboardingClient.id, {
      lifecycleStage: AgencyClientLifecycleStage.Active,
    });
    expect(publisher2.publishOnboardingCompleted).toHaveBeenCalledTimes(1);
  });

  it('does not publish lifecycle events when the lifecycle stage is unchanged', async () => {
    const client = makeClient({ lifecycleStage: AgencyClientLifecycleStage.Active });
    const { service, publisher } = makeService({ client });

    await service.update(makeContext(), client.id, { displayName: 'Updated name' });

    expect(publisher.publishOnboardingStarted).not.toHaveBeenCalled();
    expect(publisher.publishOnboardingCompleted).not.toHaveBeenCalled();
  });
});

function makeContext() {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-actor',
  };
}

function makeService(options: { client?: AgencyClient } = {}) {
  const client = options.client ?? makeClient();

  const clientsRepository = {
    findOne: jest.fn().mockResolvedValue(client),
    create: jest.fn((value: Partial<AgencyClient>) => ({ ...client, ...value })),
    save: jest.fn(async (value: AgencyClient) => value),
  };

  const publisher = {
    publishAssigned: jest.fn(),
    publishOwnerChanged: jest.fn(),
    publishOnboardingStarted: jest.fn(),
    publishOnboardingCompleted: jest.fn(),
    publishManagedTenantConnected: jest.fn(),
    publishManagedTenantDisconnected: jest.fn(),
  } as unknown as jest.Mocked<ClientNotificationPublisher>;

  const clientCostCenterService = {
    ensureForClientSafe: jest.fn().mockResolvedValue(null),
    ensureForClient: jest.fn(),
    findLinkedCostCenter: jest.fn().mockResolvedValue(null),
    syncAll: jest.fn(),
  };

  const service = new ClientsService(
    clientsRepository as unknown as Repository<AgencyClient>,
    {} as Repository<AgencyProject>,
    {} as Repository<AgencyTask>,
    {} as Repository<AgencyActivity>,
    {} as ClientsProfitabilityService,
    publisher,
    clientCostCenterService as unknown as ClientCostCenterService,
  );

  return { service, publisher, clientsRepository, clientCostCenterService };
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

function makeCreateDto(overrides: Record<string, unknown> = {}) {
  return {
    displayName: 'Novo Cliente',
    lifecycleStage: AgencyClientLifecycleStage.Active,
    healthStatus: AgencyClientHealthStatus.Healthy,
    ...overrides,
  } as any;
}
