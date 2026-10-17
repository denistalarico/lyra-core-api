import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { ManagedContextDirectoryService } from '../../../common/context/managed-context-directory.service';
import { AgencyActivity } from '../../activities/entities';
import { AgencyProject, AgencyTask } from '../../projects/entities';
import { TenantProductEntitlementEntity } from '../../platform/entities/tenant-product-entitlement.entity';
import {
  PlatformProductKey,
  ProductEntitlementSource,
  ProductEntitlementStatus,
} from '../../platform/enums/platform-product.enums';
import { UpdateClientProductDto } from '../dto';
import { AgencyClient, ClientLifecycleProcess } from '../entities';
import {
  AgencyClientHealthStatus,
  AgencyClientLifecycleStage,
  AgencyClientStatus,
} from '../enums';
import { ClientCostCenterService } from './client-cost-center.service';
import { ClientNotificationPublisher } from './client-notification.publisher';
import { ClientsProfitabilityService } from './clients-profitability.service';
import { ClientsService } from './clients.service';

describe('ClientsService client product entitlements', () => {
  it('projects LeadFlow and Social for a whole page with one entitlement query', async () => {
    const clients = [
      makeClient('client-active', 'managed-active'),
      makeClient('client-trial', 'managed-trial'),
      makeClient('client-inactive', 'managed-inactive'),
      makeClient('client-expired', 'managed-expired'),
      makeClient('client-ended-window', 'managed-ended-window'),
      makeClient('client-empty', 'managed-empty'),
      makeClient('client-unprovisioned', null),
    ];
    const now = Date.now();
    const entitlements = [
      makeEntitlement('managed-active', PlatformProductKey.Social, {
        status: ProductEntitlementStatus.Active,
      }),
      makeEntitlement('managed-active', PlatformProductKey.LeadFlow, {
        status: ProductEntitlementStatus.Active,
      }),
      makeEntitlement('managed-trial', PlatformProductKey.Social, {
        status: ProductEntitlementStatus.Trial,
        trialEndsAt: new Date(now + 60_000),
      }),
      makeEntitlement('managed-trial', PlatformProductKey.LeadFlow, {
        status: ProductEntitlementStatus.Trial,
        trialEndsAt: new Date(now - 60_000),
      }),
      makeEntitlement('managed-inactive', PlatformProductKey.Social, {
        status: ProductEntitlementStatus.Suspended,
      }),
      makeEntitlement('managed-inactive', PlatformProductKey.LeadFlow, {
        status: ProductEntitlementStatus.Cancelled,
      }),
      makeEntitlement('managed-expired', PlatformProductKey.Social, {
        status: ProductEntitlementStatus.Expired,
      }),
      makeEntitlement('managed-ended-window', PlatformProductKey.Social, {
        status: ProductEntitlementStatus.Active,
        endsAt: new Date(now - 60_000),
      }),
      // Agency entitlements are intentionally ignored for managed clients.
      makeEntitlement('managed-empty', PlatformProductKey.Agency),
    ];
    const { service, entitlementsRepository, queryBuilder } = makeService({
      clients,
      entitlements,
    });

    const result = await service.list(makeContext(), {});

    expect(entitlementsRepository.find).toHaveBeenCalledTimes(1);
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'client.tenant_id = :tenantId',
      { tenantId: 'agency-tenant' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'client.workspace_id = :workspaceId',
      { workspaceId: 'workspace-1' },
    );

    expect(product(result.items[0], 'social')).toMatchObject({
      status: 'active',
      available: true,
    });
    expect(product(result.items[0], 'leadflow')).toMatchObject({
      status: 'active',
      available: true,
    });
    expect(product(result.items[1], 'social')).toMatchObject({
      status: 'trial',
      available: true,
    });
    expect(product(result.items[1], 'leadflow')).toMatchObject({
      status: 'trial',
      available: false,
    });
    expect(product(result.items[2], 'social')).toMatchObject({
      status: 'suspended',
      available: false,
    });
    expect(product(result.items[2], 'leadflow')).toMatchObject({
      status: 'cancelled',
      available: false,
    });
    expect(product(result.items[3], 'social')).toMatchObject({
      status: 'expired',
      available: false,
    });
    expect(product(result.items[4], 'social')).toMatchObject({
      status: 'active',
      available: false,
    });
    expect(result.items[5].products).toEqual([
      expect.objectContaining({
        productKey: 'leadflow',
        status: 'not_configured',
      }),
      expect.objectContaining({
        productKey: 'social',
        status: 'not_configured',
      }),
    ]);
    expect(result.items[6]).toMatchObject({ productsProvisioned: false });
    expect(result.items[6].products.every((item) => !item.available)).toBe(
      true,
    );

    for (const item of result.items) {
      for (const summary of item.products) {
        expect(Object.keys(summary).sort()).toEqual(
          [
            'available',
            'endsAt',
            'planKey',
            'productKey',
            'startsAt',
            'status',
            'trialEndsAt',
          ].sort(),
        );
      }
    }
  });

  it('does not query entitlements when the page has no provisioned tenant', async () => {
    const { service, entitlementsRepository } = makeService({
      clients: [makeClient('client-1', null)],
    });

    const result = await service.list(makeContext(), {});

    expect(entitlementsRepository.find).not.toHaveBeenCalled();
    expect(result.items[0].productsProvisioned).toBe(false);
  });

  it.each(['active', 'suspended', 'trial', 'cancelled', null] as const)(
    'requires a company for legacy mutations even with entitlement %s',
    async (status) => {
      const { service, entitlementsRepository } = makeService({
        clients: [makeClient('client-1', 'managed-1')],
        entitlementForMutation: status
          ? makeEntitlement('managed-1', PlatformProductKey.Social, {
              status: status as ProductEntitlementStatus,
            })
          : null,
      });
      for (const action of ['activate', 'suspend'] as const) {
        await expect(
          service.updateProduct(makeContext(), 'client-1', 'social', {
            action,
          }),
        ).rejects.toMatchObject({
          response: { code: 'company_product_scope_required' },
        });
      }
      expect(entitlementsRepository.save).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['within its window', new Date(Date.now() + 86_400_000), true],
    ['past trialEndsAt', new Date(Date.now() - 86_400_000), false],
  ])(
    'projects a trial %s with available=%s',
    async (_label, trialEndsAt, expected) => {
      const client = makeClient('client-1', 'managed-1');
      const entitlement = makeEntitlement(
        'managed-1',
        PlatformProductKey.Social,
        { status: ProductEntitlementStatus.Trial, trialEndsAt },
      );
      const { service } = makeService({
        clients: [client],
        entitlements: [entitlement],
      });

      const result = await service.list(makeContext(), {});

      expect(product(result.items[0], 'social')).toMatchObject({
        status: 'trial',
        available: expected,
      });
    },
  );

  it.each([
    [
      'active inside its window',
      {
        status: ProductEntitlementStatus.Active,
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    ],
    [
      'active before startsAt',
      {
        status: ProductEntitlementStatus.Active,
        startsAt: new Date(Date.now() + 86_400_000),
      },
    ],
    [
      'trial inside its window',
      {
        status: ProductEntitlementStatus.Trial,
        trialEndsAt: new Date(Date.now() + 86_400_000),
      },
    ],
    [
      'trial past trialEndsAt',
      {
        status: ProductEntitlementStatus.Trial,
        trialEndsAt: new Date(Date.now() - 86_400_000),
      },
    ],
  ])(
    'keeps /clients and ManagedContextDirectoryService consistent for %s',
    async (_label, overrides) => {
      const client = makeClient('client-1', 'managed-1');
      const entitlement = makeEntitlement(
        'managed-1',
        PlatformProductKey.Social,
        overrides,
      );
      const { service } = makeService({
        clients: [client],
        entitlements: [entitlement],
      });
      const directoryClientsRepository = {
        find: jest.fn().mockResolvedValue([client]),
      };
      const directoryCompanyContextsRepository = {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
      };
      const directoryContactsRepository = {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
      };
      const directoryEntitlementsRepository = {
        find: jest.fn().mockResolvedValue([entitlement]),
      };
      const directory = new ManagedContextDirectoryService(
        directoryClientsRepository as never,
        directoryCompanyContextsRepository as never,
        directoryContactsRepository as never,
        directoryEntitlementsRepository as never,
        { find: jest.fn().mockResolvedValue([]) } as never,
        { find: jest.fn().mockResolvedValue([]) } as never,
        {
          find: jest.fn().mockResolvedValue([]),
          findOne: jest.fn().mockResolvedValue(null),
        } as never,
      );

      const projected = await service.list(makeContext(), {});
      const authorized = await directory.listAuthorizedClients(
        {
          tenantId: 'agency-tenant',
          workspaceId: 'workspace-1',
          userId: 'admin-user',
          role: 'owner',
        },
        PlatformProductKey.Social,
      );

      expect(authorized.length > 0).toBe(
        product(projected.items[0], 'social')?.available,
      );
    },
  );

  it('rejects unsupported products, unprovisioned clients and cross-tenant clients', async () => {
    const provisioned = makeService({
      clients: [makeClient('client-1', 'managed-1')],
    }).service;
    await expect(
      provisioned.updateProduct(makeContext(), 'client-1', 'agency', {
        action: 'activate',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const unprovisioned = makeService({
      clients: [makeClient('client-1', null)],
    }).service;
    await expect(
      unprovisioned.updateProduct(makeContext(), 'client-1', 'social', {
        action: 'activate',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const foreign = makeService({
      clients: [],
      clientForMutation: null,
    }).service;
    await expect(
      foreign.updateProduct(makeContext(), 'foreign-client', 'social', {
        action: 'activate',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a caller-supplied managedTenantId in the mutation body', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });

    await expect(
      pipe.transform(
        { action: 'activate', managedTenantId: 'attacker-controlled' },
        { type: 'body', metatype: UpdateClientProductDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function product(
  item: { products: Array<{ productKey: string; available?: boolean }> },
  key: string,
) {
  return item.products.find((entry) => entry.productKey === key);
}

function makeContext() {
  return {
    tenantId: 'agency-tenant',
    workspaceId: 'workspace-1',
    userId: 'admin-user',
  };
}

function makeService(
  options: {
    clients?: AgencyClient[];
    entitlements?: TenantProductEntitlementEntity[];
    entitlementForMutation?: TenantProductEntitlementEntity | null;
    clientForMutation?: AgencyClient | null;
  } = {},
) {
  const clients = options.clients ?? [];
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([clients, clients.length]),
  };
  const resolvedMutationClient =
    options.clientForMutation === undefined
      ? (clients[0] ?? null)
      : options.clientForMutation;
  const clientsRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    findOne: jest.fn().mockResolvedValue(resolvedMutationClient),
  };
  const lifecycleProcessesRepository = {
    find: jest.fn().mockResolvedValue([]),
  };
  const entitlementsRepository = {
    find: jest.fn().mockResolvedValue(options.entitlements ?? []),
    findOne: jest
      .fn()
      .mockResolvedValue(options.entitlementForMutation ?? null),
    create: jest.fn(
      (value: Partial<TenantProductEntitlementEntity>) =>
        ({
          id: 'new-entitlement',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...value,
        }) as TenantProductEntitlementEntity,
    ),
    save: jest.fn((value: TenantProductEntitlementEntity) =>
      Promise.resolve(value),
    ),
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
    { onClientArchived: jest.fn() } as never,
    {
      pendingForClients: jest.fn().mockResolvedValue(new Set()),
      apply: jest.fn(),
    } as never,
  );

  return { service, entitlementsRepository, queryBuilder };
}

function makeClient(id: string, managedTenantId: string | null): AgencyClient {
  const now = new Date();
  return {
    id,
    tenantId: 'agency-tenant',
    workspaceId: 'workspace-1',
    contactId: null,
    displayName: id,
    legalName: null,
    status: AgencyClientStatus.Active,
    lifecycleStage: AgencyClientLifecycleStage.Active,
    healthStatus: AgencyClientHealthStatus.Healthy,
    segment: null,
    accountOwnerId: null,
    managedTenantId,
    startDate: null,
    endDate: null,
    notes: null,
    metadata: null,
    archivedAt: null,
    archiveRequestedAt: null,
    archiveRequestedBy: null,
    archiveMode: null,
    archiveStatus: 'none',
    createdAt: now,
    updatedAt: now,
  };
}

function makeEntitlement(
  tenantId: string,
  productKey: PlatformProductKey,
  overrides: Partial<TenantProductEntitlementEntity> = {},
): TenantProductEntitlementEntity {
  const now = new Date();
  return {
    id: `${tenantId}-${productKey}`,
    tenantId,
    productKey,
    status: ProductEntitlementStatus.Active,
    source: ProductEntitlementSource.Manual,
    planKey: null,
    startsAt: null,
    endsAt: null,
    trialEndsAt: null,
    settings: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
