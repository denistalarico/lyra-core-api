import { Repository } from 'typeorm';
import { AgencyActivity } from '../../activities/entities';
import { AgencyProject, AgencyTask } from '../../projects/entities';
import { AgencyClient, ClientLifecycleProcess } from '../entities';
import { TenantProductEntitlementEntity } from '../../platform/entities/tenant-product-entitlement.entity';
import {
  AgencyClientHealthStatus,
  AgencyClientLifecycleStage,
  AgencyClientStatus,
  ClientLifecycleProcessStatus,
  ClientLifecycleProcessType,
} from '../enums';
import { ClientCostCenterService } from './client-cost-center.service';
import { ClientNotificationPublisher } from './client-notification.publisher';
import { ClientsProfitabilityService } from './clients-profitability.service';
import { ClientsService } from './clients.service';

describe('ClientsService lifecycle list status', () => {
  it('includes in-progress lifecycle processes with each client', async () => {
    const now = new Date('2026-07-26T12:00:00.000Z');
    const client = {
      id: 'client-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      displayName: 'Acme',
      status: AgencyClientStatus.Active,
      lifecycleStage: AgencyClientLifecycleStage.Active,
      healthStatus: AgencyClientHealthStatus.Healthy,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    } as AgencyClient;
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[client], 1]),
    };
    const clientsRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    const lifecycleProcessesRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'process-1',
          clientId: client.id,
          processType: ClientLifecycleProcessType.Offboarding,
          status: ClientLifecycleProcessStatus.InProgress,
          startedAt: now,
        },
      ]),
    };
    const entitlementsRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    const service = new ClientsService(
      clientsRepository as unknown as Repository<AgencyClient>,
      lifecycleProcessesRepository as unknown as Repository<ClientLifecycleProcess>,
      {} as Repository<AgencyProject>,
      {} as Repository<AgencyTask>,
      {} as Repository<AgencyActivity>,
      entitlementsRepository as unknown as Repository<TenantProductEntitlementEntity>,
      {} as ClientsProfitabilityService,
      {} as ClientNotificationPublisher,
      {} as ClientCostCenterService,
    );

    const result = await service.list(
      {
        tenantId: client.tenantId,
        workspaceId: client.workspaceId,
        userId: null,
      },
      {},
    );

    expect(result.items[0].activeLifecycleProcesses).toEqual([
      {
        id: 'process-1',
        processType: ClientLifecycleProcessType.Offboarding,
        status: ClientLifecycleProcessStatus.InProgress,
        startedAt: now,
      },
    ]);
    expect(lifecycleProcessesRepository.find).toHaveBeenCalledTimes(1);
    expect(entitlementsRepository.find).not.toHaveBeenCalled();
  });
});
