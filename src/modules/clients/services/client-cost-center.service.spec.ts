import { ClientCostCenterService } from './client-cost-center.service';
import { FinanceCostCenterType } from '../../finance/enums';
import { AgencyClient } from '../entities';

const TENANT = 'tenant-1';
const WORKSPACE = 'workspace-1';

function makeContext() {
  return { tenantId: TENANT, workspaceId: WORKSPACE, userId: 'user-1' };
}

function makeClient(overrides: Partial<AgencyClient> = {}): AgencyClient {
  return {
    id: 'client-1',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    contactId: 'contact-1',
    displayName: 'ACME',
    archivedAt: null,
    metadata: null,
    ...overrides,
  } as AgencyClient;
}

function makeService() {
  const costCentersRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((value: any) => ({ ...value })),
    save: jest.fn(async (value: any) => ({ id: value.id ?? 'cc-new', ...value })),
  };
  const clientsRepo = {
    find: jest.fn().mockResolvedValue([]),
  };
  const service = new ClientCostCenterService(
    costCentersRepo as any,
    clientsRepo as any,
  );
  return { service, costCentersRepo, clientsRepo };
}

describe('ClientCostCenterService', () => {
  it('creates a new cost center linked to the client when none exists', async () => {
    const { service, costCentersRepo } = makeService();

    const result = await service.ensureForClient(makeContext(), makeClient());

    expect(result.action).toBe('created');
    expect(costCentersRepo.create).toHaveBeenCalledTimes(1);
    const created = costCentersRepo.create.mock.calls[0][0];
    expect(created).toMatchObject({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      name: 'Cliente — ACME',
      type: FinanceCostCenterType.Client,
      relatedEntityType: 'client',
      relatedEntityId: 'client-1',
      active: true,
    });
  });

  it('is idempotent: returns the existing cost center without creating a duplicate', async () => {
    const { service, costCentersRepo } = makeService();
    costCentersRepo.findOne.mockResolvedValueOnce({
      id: 'cc-existing',
      relatedEntityId: 'client-1',
    });

    const result = await service.ensureForClient(makeContext(), makeClient());

    expect(result.action).toBe('existing');
    expect(result.costCenter.id).toBe('cc-existing');
    expect(costCentersRepo.create).not.toHaveBeenCalled();
    expect(costCentersRepo.save).not.toHaveBeenCalled();
  });

  it('links an unlinked cost center with the same name instead of duplicating', async () => {
    const { service, costCentersRepo } = makeService();
    costCentersRepo.findOne
      .mockResolvedValueOnce(null) // not yet linked
      .mockResolvedValueOnce({
        id: 'cc-orphan',
        name: 'Cliente — ACME',
        relatedEntityId: null,
        metadata: {},
      }); // unlinked same-name match

    const result = await service.ensureForClient(makeContext(), makeClient());

    expect(result.action).toBe('linked');
    expect(costCentersRepo.create).not.toHaveBeenCalled();
    const saved = costCentersRepo.save.mock.calls[0][0];
    expect(saved.id).toBe('cc-orphan');
    expect(saved.relatedEntityId).toBe('client-1');
    expect(saved.relatedEntityType).toBe('client');
    expect(saved.type).toBe(FinanceCostCenterType.Client);
  });

  it('scopes the linked lookup by tenant and workspace', async () => {
    const { service, costCentersRepo } = makeService();
    await service.findLinkedCostCenter(makeContext(), 'client-9');
    const where = costCentersRepo.findOne.mock.calls[0][0].where;
    expect(where).toMatchObject({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      type: FinanceCostCenterType.Client,
      relatedEntityType: 'client',
      relatedEntityId: 'client-9',
    });
  });

  it('syncAll backfills only non-archived clients and aggregates outcomes', async () => {
    const { service, clientsRepo } = makeService();
    clientsRepo.find.mockResolvedValue([
      makeClient({ id: 'c1' }),
      makeClient({ id: 'c2' }),
      makeClient({ id: 'c3' }),
    ]);
    jest
      .spyOn(service, 'ensureForClientSafe')
      .mockResolvedValueOnce({ costCenter: {} as any, action: 'created' })
      .mockResolvedValueOnce({ costCenter: {} as any, action: 'linked' })
      .mockResolvedValueOnce({ costCenter: {} as any, action: 'existing' });

    const result = await service.syncAll(makeContext());

    expect(clientsRepo.find.mock.calls[0][0].where).toMatchObject({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
    });
    expect(result).toEqual({
      processed: 3,
      created: 1,
      linked: 1,
      existing: 1,
    });
  });
});
