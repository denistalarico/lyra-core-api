import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Not } from 'typeorm';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import type { AgencyClient } from '../../clients/entities';
import { TenantProductEntitlementEntity } from '../../platform';
import type { LeadFlowBusinessModeTemplateEntity } from '../entities';
import { LeadFlowClientSettingsEntity } from '../entities';
import { LeadFlowSettingsContextType } from '../enums/leadflow-settings-context-type.enum';
import { LeadFlowSettingsStatus } from '../enums/leadflow-settings-status.enum';
import { CompanyContextService } from './company-context.service';
import type { LeadFlowBusinessModeTemplateService } from './leadflow-business-mode-template.service';
import { LeadFlowClientSettingsService } from './leadflow-client-settings.service';

describe('LeadFlowClientSettingsService tenant/workspace isolation', () => {
  const ctx: RequestContext = {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    userId: 'user-a',
  };

  function setup() {
    const agencyClientsRepository = {
      findOne: jest.fn(),
    } as unknown as Repository<AgencyClient>;
    const settingsRepository = {
      findOne: jest.fn(),
      count: jest.fn(),
    } as unknown as Repository<LeadFlowClientSettingsEntity>;
    const entitlementsRepository = {
      findOne: jest.fn(),
    } as unknown as Repository<TenantProductEntitlementEntity>;
    const service = new LeadFlowClientSettingsService(
      {} as DataSource,
      agencyClientsRepository,
      settingsRepository,
      entitlementsRepository,
      {} as LeadFlowBusinessModeTemplateService,
      new CompanyContextService(),
    );

    return {
      service,
      agencyClientsRepository,
      settingsRepository,
      entitlementsRepository,
    };
  }

  it('scopes client lookup by tenant, workspace, context and client id', async () => {
    const { service, agencyClientsRepository, settingsRepository } = setup();
    jest
      .mocked(agencyClientsRepository.findOne)
      .mockResolvedValue({ id: 'client-a' } as AgencyClient);
    jest.mocked(settingsRepository.findOne).mockResolvedValue(null);

    await expect(service.getSettings(ctx, 'client-a')).rejects.toThrow(
      NotFoundException,
    );

    expect(agencyClientsRepository.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'client-a',
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
      }),
    });
    expect(settingsRepository.findOne).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        contextType: LeadFlowSettingsContextType.Client,
        agencyClientId: 'client-a',
      },
    });
  });

  it('scopes agency lookup by tenant and workspace', async () => {
    const { service, settingsRepository } = setup();
    jest.mocked(settingsRepository.findOne).mockResolvedValue(null);

    await expect(service.getAgencySettings(ctx)).rejects.toThrow(
      NotFoundException,
    );

    expect(settingsRepository.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        contextType: LeadFlowSettingsContextType.Agency,
      }),
    });
  });
});

describe('LeadFlowClientSettingsService company capacity', () => {
  const ctx: RequestContext = {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    userId: 'user-a',
  };

  const template = {
    key: 'default',
    id: 'template-1',
    recommendedApps: [],
    supportedIntegrations: {},
    clientPromptSchema: null,
  } as unknown as LeadFlowBusinessModeTemplateEntity;

  function buildEntitlement(
    maxManagedClients: number | null,
  ): TenantProductEntitlementEntity {
    return {
      tenantId: 'tenant-a',
      productKey: 'leadflow',
      status: 'active',
      settings:
        maxManagedClients === null ? {} : { maxManagedClients },
    } as unknown as TenantProductEntitlementEntity;
  }

  function setup() {
    const agencyClientsRepository = {
      findOne: jest
        .fn()
        .mockResolvedValue({
          id: 'client-a',
          managedTenantId: 'managed-a',
        } as AgencyClient),
    } as unknown as Repository<AgencyClient>;
    const settingsRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn(),
      save: jest.fn(async (entity: unknown) => entity),
    } as unknown as Repository<LeadFlowClientSettingsEntity>;
    const entitlementsRepository = {
      findOne: jest.fn(),
    } as unknown as Repository<TenantProductEntitlementEntity>;
    const businessModeTemplateService = {
      getTemplateByKey: jest.fn().mockResolvedValue(template),
    } as unknown as LeadFlowBusinessModeTemplateService;

    const managerEntitlementRepo = { findOne: jest.fn() };
    const managerSettingsRepo = {
      count: jest.fn(),
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (entity: unknown) => entity),
    };
    const dataSource = {
      transaction: jest.fn(async (cb: (manager: EntityManager) => unknown) =>
        cb({
          getRepository: jest.fn((entity: unknown) => {
            if (entity === TenantProductEntitlementEntity) {
              return managerEntitlementRepo;
            }
            if (entity === LeadFlowClientSettingsEntity) {
              return managerSettingsRepo;
            }
            throw new Error('Unexpected repository requested in test');
          }),
        } as unknown as EntityManager),
      ),
    } as unknown as DataSource;

    const service = new LeadFlowClientSettingsService(
      dataSource,
      agencyClientsRepository,
      settingsRepository,
      entitlementsRepository,
      businessModeTemplateService,
      new CompanyContextService(),
    );

    return {
      service,
      agencyClientsRepository,
      settingsRepository,
      entitlementsRepository,
      dataSource,
      managerEntitlementRepo,
      managerSettingsRepo,
    };
  }

  it('reports unlimited capacity when the tenant has no LeadFlow entitlement configured', async () => {
    const { service, settingsRepository, entitlementsRepository } = setup();
    jest.mocked(entitlementsRepository.findOne).mockResolvedValue(null);
    jest.mocked(settingsRepository.count).mockResolvedValue(5);

    const capacity = await service.getCapacity(ctx);

    expect(capacity).toEqual({
      activeCompanies: 5,
      limit: null,
      availableSlots: null,
      planKey: null,
      entitlementStatus: null,
    });
  });

  it('computes remaining slots against the configured limit, scoped to tenant and workspace', async () => {
    const { service, settingsRepository, entitlementsRepository } = setup();
    jest
      .mocked(entitlementsRepository.findOne)
      .mockResolvedValue(buildEntitlement(3));
    jest.mocked(settingsRepository.count).mockResolvedValue(1);

    const capacity = await service.getCapacity(ctx);

    expect(capacity.limit).toBe(3);
    expect(capacity.activeCompanies).toBe(1);
    expect(capacity.availableSlots).toBe(2);
    expect(settingsRepository.count).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        contextType: LeadFlowSettingsContextType.Client,
        status: Not(LeadFlowSettingsStatus.Archived),
      },
    });
  });

  it('reports zero available slots when active companies already match a zero limit', async () => {
    const { service, settingsRepository, entitlementsRepository } = setup();
    jest
      .mocked(entitlementsRepository.findOne)
      .mockResolvedValue(buildEntitlement(0));
    jest.mocked(settingsRepository.count).mockResolvedValue(0);

    const capacity = await service.getCapacity(ctx);

    expect(capacity.limit).toBe(0);
    expect(capacity.availableSlots).toBe(0);
  });

  it('blocks creating a new company once the tenant limit is reached, without persisting anything', async () => {
    const { service, managerEntitlementRepo, managerSettingsRepo } = setup();
    managerEntitlementRepo.findOne.mockResolvedValue(buildEntitlement(2));
    managerSettingsRepo.count.mockResolvedValue(2);

    await expect(
      service.createSettings(ctx, 'client-a', {
        businessModeKey: 'default',
      } as never),
    ).rejects.toThrow(ForbiddenException);

    expect(managerEntitlementRepo.findOne).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', productKey: 'leadflow' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(managerSettingsRepo.save).not.toHaveBeenCalled();
  });

  it('allows creating a new company while a slot remains under the tenant limit', async () => {
    const { service, managerEntitlementRepo, managerSettingsRepo } = setup();
    managerEntitlementRepo.findOne.mockResolvedValue(buildEntitlement(2));
    managerSettingsRepo.count.mockResolvedValue(1);

    await service.createSettings(ctx, 'client-a', {
      businessModeKey: 'default',
    } as never);

    expect(managerSettingsRepo.save).toHaveBeenCalled();
  });

  it('does not gate creation when the tenant has no configured company limit', async () => {
    const { service, managerEntitlementRepo, managerSettingsRepo } = setup();
    managerEntitlementRepo.findOne.mockResolvedValue(null);

    await service.createSettings(ctx, 'client-a', {
      businessModeKey: 'default',
    } as never);

    expect(managerSettingsRepo.count).not.toHaveBeenCalled();
    expect(managerSettingsRepo.save).toHaveBeenCalled();
  });

  it('blocks reactivating an archived company once the tenant limit is reached', async () => {
    const {
      service,
      settingsRepository,
      managerEntitlementRepo,
      managerSettingsRepo,
    } = setup();
    jest.mocked(settingsRepository.findOne).mockResolvedValue({
      id: 'settings-a',
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      contextType: LeadFlowSettingsContextType.Client,
      status: LeadFlowSettingsStatus.Archived,
    } as LeadFlowClientSettingsEntity);
    managerEntitlementRepo.findOne.mockResolvedValue(buildEntitlement(1));
    managerSettingsRepo.count.mockResolvedValue(1);

    await expect(
      service.updateSettings(ctx, 'client-a', {
        status: LeadFlowSettingsStatus.Active,
      } as never),
    ).rejects.toThrow(ForbiddenException);

    expect(managerSettingsRepo.save).not.toHaveBeenCalled();
  });

  it('allows reactivating an archived company when a slot is available', async () => {
    const {
      service,
      settingsRepository,
      managerEntitlementRepo,
      managerSettingsRepo,
    } = setup();
    jest.mocked(settingsRepository.findOne).mockResolvedValue({
      id: 'settings-a',
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      contextType: LeadFlowSettingsContextType.Client,
      status: LeadFlowSettingsStatus.Archived,
    } as LeadFlowClientSettingsEntity);
    managerEntitlementRepo.findOne.mockResolvedValue(buildEntitlement(2));
    managerSettingsRepo.count.mockResolvedValue(1);

    await service.updateSettings(ctx, 'client-a', {
      status: LeadFlowSettingsStatus.Active,
    } as never);

    expect(managerSettingsRepo.save).toHaveBeenCalled();
  });

  it('does not run the capacity check for ordinary status updates that do not reactivate a company', async () => {
    const { service, settingsRepository, dataSource } = setup();
    jest.mocked(settingsRepository.findOne).mockResolvedValue({
      id: 'settings-a',
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      contextType: LeadFlowSettingsContextType.Client,
      status: LeadFlowSettingsStatus.Draft,
    } as LeadFlowClientSettingsEntity);

    await service.updateSettings(ctx, 'client-a', {
      status: LeadFlowSettingsStatus.Active,
    } as never);

    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
