import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
import { InboxDomainOutboxEntity } from '../../inbox/entities/inbox-domain-outbox.entity';
import {
  LeadFlowBriefingContextSnapshotEntity,
  LeadFlowBriefingExtractionJobEntity,
  LeadFlowBriefingSourceEntity,
  LeadFlowBriefingSuggestionApplicationEntity,
  LeadFlowBriefingSuggestionEntity,
} from '../../leadflow-briefing/entities';
import { LeadFlowBriefingSnapshotKind } from '../../leadflow-briefing/enums/leadflow-briefing-snapshot-kind.enum';

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
    maxManagedClients: number | 'unlimited' | null,
  ): TenantProductEntitlementEntity {
    return {
      tenantId: 'tenant-a',
      productKey: 'leadflow',
      status: 'active',
      settings:
        maxManagedClients === null ? {} : { maxManagedClients },
    } as unknown as TenantProductEntitlementEntity;
  }

  const originalUnlimitedTenants =
    process.env.LEADFLOW_UNLIMITED_COMPANY_TENANTS;

  afterEach(() => {
    if (originalUnlimitedTenants === undefined) {
      delete process.env.LEADFLOW_UNLIMITED_COMPANY_TENANTS;
    } else {
      process.env.LEADFLOW_UNLIMITED_COMPANY_TENANTS =
        originalUnlimitedTenants;
    }
  });

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

  it('falls back to the default allowance when the tenant has no LeadFlow entitlement configured', async () => {
    const { service, settingsRepository, entitlementsRepository } = setup();
    delete process.env.LEADFLOW_UNLIMITED_COMPANY_TENANTS;
    jest.mocked(entitlementsRepository.findOne).mockResolvedValue(null);
    jest.mocked(settingsRepository.count).mockResolvedValue(5);

    const capacity = await service.getCapacity(ctx);

    expect(capacity).toEqual({
      activeCompanies: 5,
      limit: 10,
      availableSlots: 5,
      planKey: null,
      entitlementStatus: null,
    });
  });

  it('reports unlimited capacity for a tenant on the unlimited allowlist', async () => {
    const { service, settingsRepository, entitlementsRepository } = setup();
    process.env.LEADFLOW_UNLIMITED_COMPANY_TENANTS = 'tenant-z, tenant-a';
    jest.mocked(entitlementsRepository.findOne).mockResolvedValue(null);
    jest.mocked(settingsRepository.count).mockResolvedValue(42);

    const capacity = await service.getCapacity(ctx);

    expect(capacity.limit).toBeNull();
    expect(capacity.availableSlots).toBeNull();
  });

  it('reports unlimited capacity when the entitlement pins maxManagedClients to "unlimited"', async () => {
    const { service, settingsRepository, entitlementsRepository } = setup();
    delete process.env.LEADFLOW_UNLIMITED_COMPANY_TENANTS;
    jest
      .mocked(entitlementsRepository.findOne)
      .mockResolvedValue(buildEntitlement('unlimited'));
    jest.mocked(settingsRepository.count).mockResolvedValue(42);

    const capacity = await service.getCapacity(ctx);

    expect(capacity.limit).toBeNull();
    expect(capacity.availableSlots).toBeNull();
  });

  it('keeps an explicit entitlement limit ahead of the unlimited allowlist', async () => {
    const { service, settingsRepository, entitlementsRepository } = setup();
    process.env.LEADFLOW_UNLIMITED_COMPANY_TENANTS = 'tenant-a';
    jest
      .mocked(entitlementsRepository.findOne)
      .mockResolvedValue(buildEntitlement(3));
    jest.mocked(settingsRepository.count).mockResolvedValue(1);

    const capacity = await service.getCapacity(ctx);

    expect(capacity.limit).toBe(3);
    expect(capacity.availableSlots).toBe(2);
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

  it('applies the default allowance to a tenant with no entitlement instead of skipping the gate', async () => {
    const { service, managerEntitlementRepo, managerSettingsRepo } = setup();
    delete process.env.LEADFLOW_UNLIMITED_COMPANY_TENANTS;
    managerEntitlementRepo.findOne.mockResolvedValue(null);
    managerSettingsRepo.count.mockResolvedValue(10);

    await expect(
      service.createSettings(ctx, 'client-a', {
        businessModeKey: 'default',
      } as never),
    ).rejects.toThrow(ForbiddenException);

    expect(managerSettingsRepo.save).not.toHaveBeenCalled();
  });

  it('does not gate creation for a tenant on the unlimited allowlist', async () => {
    const { service, managerEntitlementRepo, managerSettingsRepo } = setup();
    process.env.LEADFLOW_UNLIMITED_COMPANY_TENANTS = 'tenant-a';
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

describe('LeadFlowClientSettingsService.deleteSettings', () => {
  const ctx: RequestContext = {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    userId: 'user-a',
  };

  function setup(settings: Partial<LeadFlowClientSettingsEntity> | null) {
    const agencyClientsRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'client-a',
        managedTenantId: 'managed-a',
      } as AgencyClient),
    } as unknown as Repository<AgencyClient>;
    const settingsRepository = {
      findOne: jest.fn().mockResolvedValue(settings),
    } as unknown as Repository<LeadFlowClientSettingsEntity>;
    const entitlementsRepository = {
      findOne: jest.fn(),
    } as unknown as Repository<TenantProductEntitlementEntity>;

    const deletedByEntity: unknown[] = [];
    const dataSource = {
      transaction: jest.fn(async (cb: (manager: EntityManager) => unknown) =>
        cb({
          getRepository: jest.fn((entity: unknown) => ({
            delete: jest.fn(async (criteria: unknown) => {
              deletedByEntity.push({ entity, criteria });
              return { affected: 1 };
            }),
          })),
        } as unknown as EntityManager),
      ),
    } as unknown as DataSource;

    const service = new LeadFlowClientSettingsService(
      dataSource,
      agencyClientsRepository,
      settingsRepository,
      entitlementsRepository,
      {} as unknown as LeadFlowBusinessModeTemplateService,
      new CompanyContextService(),
    );

    return { service, dataSource, deletedByEntity };
  }

  it('refuses to delete a company that is not archived yet', async () => {
    const { service, dataSource } = setup({
      id: 'settings-a',
      status: LeadFlowSettingsStatus.Paused,
    } as LeadFlowClientSettingsEntity);

    await expect(service.deleteSettings(ctx, 'client-a')).rejects.toThrow(
      ConflictException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('reports a missing configuration instead of silently succeeding', async () => {
    const { service, dataSource } = setup(null);

    await expect(service.deleteSettings(ctx, 'client-a')).rejects.toThrow(
      NotFoundException,
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('clears the briefing provenance before the settings row, in FK order', async () => {
    const { service, deletedByEntity } = setup({
      id: 'settings-a',
      status: LeadFlowSettingsStatus.Archived,
    } as LeadFlowClientSettingsEntity);

    await service.deleteSettings(ctx, 'client-a');

    expect(deletedByEntity).toEqual([
      {
        entity: LeadFlowBriefingSuggestionApplicationEntity,
        criteria: { settingsId: 'settings-a' },
      },
      {
        entity: LeadFlowBriefingSuggestionEntity,
        criteria: { settingsId: 'settings-a' },
      },
      {
        entity: LeadFlowBriefingExtractionJobEntity,
        criteria: { settingsId: 'settings-a' },
      },
      {
        entity: LeadFlowBriefingContextSnapshotEntity,
        criteria: { settingsId: 'settings-a' },
      },
      {
        entity: LeadFlowBriefingSourceEntity,
        criteria: { settingsId: 'settings-a' },
      },
      {
        entity: LeadFlowClientSettingsEntity,
        criteria: { id: 'settings-a' },
      },
    ]);
  });
});

describe('LeadFlowClientSettingsService.previewCompanyContext', () => {
  const ctx: RequestContext = {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    userId: 'user-a',
  };

  function buildSettings(overrides: Record<string, unknown> = {}) {
    return {
      id: 'settings-1',
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      companyContextDraft: {},
      companyContextPublished: {},
      companyContextPublishedVersion: 1,
      companyContextPublishedHash: 'prev-hash',
      ...overrides,
    } as unknown as LeadFlowClientSettingsEntity;
  }

  function setup(
    settings: LeadFlowClientSettingsEntity | null,
    applications: Record<string, unknown>[] = [],
  ) {
    const settingsRepository = {
      findOne: jest.fn().mockResolvedValue(settings),
    } as unknown as Repository<LeadFlowClientSettingsEntity>;
    const applicationRepo = {
      find: jest.fn().mockResolvedValue(applications),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === LeadFlowBriefingSuggestionApplicationEntity)
          return applicationRepo;
        throw new Error('Unexpected repository requested in test.');
      }),
    };
    const service = new LeadFlowClientSettingsService(
      dataSource as unknown as DataSource,
      {} as unknown as Repository<AgencyClient>,
      settingsRepository,
      {} as unknown as Repository<TenantProductEntitlementEntity>,
      {} as LeadFlowBusinessModeTemplateService,
      new CompanyContextService(),
    );
    return { service, settingsRepository, applicationRepo };
  }

  it('reports no changes when the draft equals the last published snapshot', async () => {
    const { service } = setup(
      buildSettings({
        companyContextDraft: { identity: { publicName: 'Acme' } },
        companyContextPublished: { identity: { publicName: 'Acme' } },
      }),
    );

    const result = await service.previewCompanyContext(ctx);

    expect(result.hasChanges).toBe(false);
    expect(result.changes).toEqual([]);
  });

  it('tags a changed scalar field "suggestion" when a matching applied suggestion exists', async () => {
    const { service } = setup(
      buildSettings({
        companyContextDraft: { identity: { publicName: 'New Name' } },
        companyContextPublished: { identity: { publicName: 'Old Name' } },
      }),
      [
        {
          fieldPath: 'identity.publicName',
          appliedValue: 'New Name',
          suggestionId: 'sug-1',
          appliedById: 'user-ai',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    );

    const result = await service.previewCompanyContext(ctx);

    expect(result.changes).toContainEqual(
      expect.objectContaining({
        fieldPath: 'identity.publicName',
        origin: 'suggestion',
        suggestionId: 'sug-1',
        appliedById: 'user-ai',
      }),
    );
  });

  it('tags a changed scalar field "manual" when the latest application no longer matches the draft value', async () => {
    const { service } = setup(
      buildSettings({
        companyContextDraft: { identity: { publicName: 'Manually Typed' } },
        companyContextPublished: { identity: { publicName: 'Old Name' } },
      }),
      [
        {
          fieldPath: 'identity.publicName',
          appliedValue: 'Something Else Entirely',
          suggestionId: 'sug-1',
          appliedById: 'user-ai',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    );

    const result = await service.previewCompanyContext(ctx);

    expect(result.changes).toContainEqual(
      expect.objectContaining({
        fieldPath: 'identity.publicName',
        origin: 'manual',
      }),
    );
  });

  it('tags a changed list field (offers) "manual" regardless of applications', async () => {
    const { service } = setup(
      buildSettings({
        companyContextDraft: { offers: ['Consultoria'] },
        companyContextPublished: { offers: [] },
      }),
    );

    const result = await service.previewCompanyContext(ctx);

    expect(result.changes).toContainEqual(
      expect.objectContaining({ fieldPath: 'offers', origin: 'manual' }),
    );
  });

  it('404s when settings do not exist for this tenant', async () => {
    const { service } = setup(null);
    await expect(service.previewCompanyContext(ctx)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('LeadFlowClientSettingsService.publishCompanyContext', () => {
  const ctx: RequestContext = {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    userId: 'user-a',
  };

  const baseSettings = {
    id: 'settings-1',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    companyContextDraft: { identity: { publicName: 'Acme' } },
    companyContextPublished: {},
    companyContextPublishedVersion: 0,
    companyContextPublishedHash: null,
  };

  function setupPublish(settings: Record<string, unknown> | null) {
    const locked = settings ? { ...settings } : null;
    const settingsEntityRepo = {
      findOne: jest.fn().mockResolvedValue(locked),
      save: jest.fn().mockImplementation((row) => Promise.resolve(row)),
    };
    const outboxRepo = {
      create: jest.fn((row) => row),
      save: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
    };
    const snapshotRepo = {
      create: jest.fn((row) => row),
      save: jest.fn().mockResolvedValue({ id: 'snapshot-1' }),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === LeadFlowClientSettingsEntity) return settingsEntityRepo;
        if (entity === InboxDomainOutboxEntity) return outboxRepo;
        if (entity === LeadFlowBriefingContextSnapshotEntity) return snapshotRepo;
        throw new Error('Unexpected repository requested in test.');
      }),
    };
    const outerSettingsRepo = {
      findOne: jest.fn().mockResolvedValue(settings),
    } as unknown as Repository<LeadFlowClientSettingsEntity>;
    const dataSource = {
      transaction: jest.fn(async (run: (m: typeof manager) => Promise<unknown>) =>
        run(manager),
      ),
    };
    const service = new LeadFlowClientSettingsService(
      dataSource as unknown as DataSource,
      {} as unknown as Repository<AgencyClient>,
      outerSettingsRepo,
      {} as unknown as Repository<TenantProductEntitlementEntity>,
      {} as LeadFlowBusinessModeTemplateService,
      new CompanyContextService(),
    );
    return { service, settingsEntityRepo, outboxRepo, snapshotRepo };
  }

  it('rejects publish when expectedDraftHash does not match the current draft hash (optimistic concurrency)', async () => {
    const { service, settingsEntityRepo } = setupPublish(baseSettings);

    await expect(
      service.publishCompanyContext(ctx, undefined, 'stale-hash'),
    ).rejects.toThrow(ConflictException);
    expect(settingsEntityRepo.save).not.toHaveBeenCalled();
  });

  it('publishes when expectedDraftHash matches the current draft hash', async () => {
    const { service, settingsEntityRepo } = setupPublish(baseSettings);
    const preview = new CompanyContextService().previewPersisted(
      baseSettings.companyContextDraft,
    );

    await service.publishCompanyContext(ctx, undefined, preview.hash);

    expect(settingsEntityRepo.save).toHaveBeenCalled();
  });

  it('publishes when expectedDraftHash is omitted', async () => {
    const { service, settingsEntityRepo } = setupPublish(baseSettings);

    await service.publishCompanyContext(ctx);

    expect(settingsEntityRepo.save).toHaveBeenCalled();
  });

  it('hash is stable: hashing the same normalized draft twice yields the same hash', () => {
    const companyContextService = new CompanyContextService();
    const normalized = companyContextService.normalizePersisted(
      baseSettings.companyContextDraft,
    );

    expect(companyContextService.hash(normalized)).toEqual(
      companyContextService.hash(normalized),
    );
  });

  it('records a Published-kind snapshot row with the new publishedVersion', async () => {
    const { service, snapshotRepo } = setupPublish({
      ...baseSettings,
      companyContextPublishedVersion: 3,
    });

    await service.publishCompanyContext(ctx);

    expect(snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotKind: LeadFlowBriefingSnapshotKind.Published,
        publishedVersion: 4,
        settingsId: 'settings-1',
      }),
    );
  });

  it('404s when settings do not exist for this tenant', async () => {
    const { service } = setupPublish(null);

    await expect(service.publishCompanyContext(ctx)).rejects.toThrow(
      NotFoundException,
    );
  });
});
