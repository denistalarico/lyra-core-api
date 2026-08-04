import { ConfigService } from '@nestjs/config';
import { PlatformContextService } from './platform-context.service';
import type { PlatformAccountEntity } from './entities/platform-account.entity';
import type { TenantProductEntitlementEntity } from './entities/tenant-product-entitlement.entity';
import {
  PlatformAccountStatus,
  PlatformAccountType,
  PlatformOnboardingMode,
} from './enums/platform-account.enums';
import { PlatformProductKey } from './enums/platform-product.enums';
import {
  ProductEntitlementSource,
  ProductEntitlementStatus,
} from './enums/platform-product.enums';

type EntitlementRepositoryMock = {
  find: jest.Mock<Promise<TenantProductEntitlementEntity[]>, [unknown]>;
};

type PlatformAccountRepositoryMock = {
  findOne: jest.Mock<Promise<PlatformAccountEntity | null>, [unknown]>;
};

function createService(options?: {
  account?: PlatformAccountEntity | null;
  fallbackProduct?: string;
  entitlements?: TenantProductEntitlementEntity[];
  authorizedClients?: unknown[];
}) {
  const entitlementsRepository: EntitlementRepositoryMock = {
    find: jest.fn().mockResolvedValue(options?.entitlements ?? []),
  };
  const platformAccountsRepository: PlatformAccountRepositoryMock = {
    findOne: jest.fn().mockResolvedValue(options?.account ?? null),
  };
  const configService = {
    get: jest.fn((key: string) =>
      key === 'PLATFORM_COMPATIBILITY_DEFAULT_PRODUCT'
        ? options?.fallbackProduct
        : undefined,
    ),
  } as Pick<ConfigService, 'get'> as ConfigService;

  const managedContextDirectory = {
    resolveActiveContext: jest.fn().mockImplementation((_identity, requested) =>
      Promise.resolve({
        active: {
          kind: 'agency',
          productKey: requested?.productKey ?? 'agency',
          clientId: null,
          managedTenantId: null,
          displayName: null,
        },
        requested: requested ?? {
          productKey: null,
          operatingMode: null,
          clientId: null,
        },
        rejection: null,
      }),
    ),
    listAuthorizedClients: jest
      .fn()
      .mockResolvedValue(options?.authorizedClients ?? []),
  };

  return {
    service: new PlatformContextService(
      entitlementsRepository as never,
      platformAccountsRepository as never,
      configService,
      managedContextDirectory as never,
    ),
    entitlementsRepository,
    platformAccountsRepository,
    managedContextDirectory,
  };
}

function makeEntitlement(
  productKey: PlatformProductKey,
  status: ProductEntitlementStatus,
  overrides: Partial<TenantProductEntitlementEntity> = {},
): TenantProductEntitlementEntity {
  return {
    id: `${productKey}-entitlement`,
    tenantId: 'tenant-1',
    productKey,
    status,
    source: ProductEntitlementSource.Subscription,
    planKey: null,
    startsAt: null,
    endsAt: null,
    trialEndsAt: null,
    settings: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeAccount(
  accountType: PlatformAccountType,
  overrides: Partial<PlatformAccountEntity> = {},
): PlatformAccountEntity {
  return {
    id: `${accountType}-account`,
    tenantId: 'tenant-1',
    accountType,
    status: PlatformAccountStatus.Active,
    displayName: null,
    onboardingMode: null,
    settings: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

const contextInput = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  role: 'admin',
};

function findProduct(
  products: Awaited<
    ReturnType<PlatformContextService['getContext']>
  >['products'],
  productKey: PlatformProductKey,
) {
  const product = products.find((item) => item.key === productKey);

  if (!product) {
    throw new Error(`Missing product ${productKey}`);
  }

  return product;
}

describe('PlatformContextService', () => {
  it('returns Agency account when a persisted account exists', async () => {
    const { service } = createService({
      account: makeAccount(PlatformAccountType.Agency, {
        displayName: 'Lyra Agency Demo',
        onboardingMode: PlatformOnboardingMode.Agency,
      }),
    });

    const response = await service.getContext(contextInput);

    expect(response.account).toEqual({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      type: 'agency',
      status: 'active',
      displayName: 'Lyra Agency Demo',
      onboardingMode: 'agency',
    });
  });

  it('returns Business account when a persisted account exists', async () => {
    const { service } = createService({
      account: makeAccount(PlatformAccountType.Business, {
        status: PlatformAccountStatus.Suspended,
        onboardingMode: PlatformOnboardingMode.OwnBusiness,
      }),
    });

    const response = await service.getContext(contextInput);

    expect(response.account).toMatchObject({
      type: 'business',
      status: 'suspended',
      displayName: null,
      onboardingMode: 'own_business',
    });
  });

  it('returns unknown account fields when no persisted account exists', async () => {
    const { service } = createService();

    const response = await service.getContext(contextInput);

    expect(response.account).toEqual({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      type: 'unknown',
      status: 'unknown',
      displayName: null,
      onboardingMode: null,
    });
  });

  it('does not infer account type from an Agency entitlement', async () => {
    const { service } = createService({
      entitlements: [
        makeEntitlement(
          PlatformProductKey.Agency,
          ProductEntitlementStatus.Active,
        ),
      ],
    });

    const response = await service.getContext(contextInput);

    expect(response.account.type).toBe('unknown');
    expect(response.account.status).toBe('unknown');
    expect(
      findProduct(response.products, PlatformProductKey.Agency).access,
    ).toBe('available');
  });

  it('returns Agency available when tenant has no rows and fallback is agency', async () => {
    const { service } = createService({ fallbackProduct: 'agency' });

    const response = await service.getContext(contextInput);

    expect(
      findProduct(response.products, PlatformProductKey.Agency),
    ).toMatchObject({
      access: 'available',
      status: 'active',
      source: 'compatibility',
    });
    expect(
      findProduct(response.products, PlatformProductKey.LeadFlow).access,
    ).toBe('locked');
    expect(
      findProduct(response.products, PlatformProductKey.Social).access,
    ).toBe('locked');
  });

  it('returns all products locked when tenant has no rows and no fallback', async () => {
    const { service } = createService();

    const response = await service.getContext(contextInput);

    expect(response.products).toHaveLength(3);
    expect(
      response.products.every((product) => product.access === 'locked'),
    ).toBe(true);
  });

  it('returns LeadFlow available when LeadFlow is active', async () => {
    const { service } = createService({
      entitlements: [
        makeEntitlement(
          PlatformProductKey.LeadFlow,
          ProductEntitlementStatus.Active,
        ),
      ],
    });

    const response = await service.getContext(contextInput);

    expect(
      findProduct(response.products, PlatformProductKey.LeadFlow),
    ).toMatchObject({
      access: 'available',
      status: 'active',
    });
  });

  it('returns Social available when Social trial is valid', async () => {
    const { service } = createService({
      entitlements: [
        makeEntitlement(
          PlatformProductKey.Social,
          ProductEntitlementStatus.Trial,
          { trialEndsAt: new Date('2999-01-01T00:00:00.000Z') },
        ),
      ],
    });

    const response = await service.getContext(contextInput);

    expect(
      findProduct(response.products, PlatformProductKey.Social),
    ).toMatchObject({
      access: 'available',
      status: 'trial',
    });
  });

  it('returns Social locked and expired when Social trial is expired', async () => {
    const { service } = createService({
      entitlements: [
        makeEntitlement(
          PlatformProductKey.Social,
          ProductEntitlementStatus.Trial,
          { trialEndsAt: new Date('2000-01-01T00:00:00.000Z') },
        ),
      ],
    });

    const response = await service.getContext(contextInput);

    expect(
      findProduct(response.products, PlatformProductKey.Social),
    ).toMatchObject({
      access: 'locked',
      status: 'expired',
    });
  });

  it('returns suspended entitlements locked', async () => {
    const { service } = createService({
      entitlements: [
        makeEntitlement(
          PlatformProductKey.Agency,
          ProductEntitlementStatus.Suspended,
        ),
      ],
    });

    const response = await service.getContext(contextInput);

    expect(
      findProduct(response.products, PlatformProductKey.Agency),
    ).toMatchObject({
      access: 'locked',
      status: 'suspended',
    });
  });

  it('does not apply fallback when tenant has any persisted row', async () => {
    const { service } = createService({
      fallbackProduct: 'agency',
      entitlements: [
        makeEntitlement(
          PlatformProductKey.LeadFlow,
          ProductEntitlementStatus.Active,
        ),
      ],
    });

    const response = await service.getContext(contextInput);

    expect(
      findProduct(response.products, PlatformProductKey.Agency),
    ).toMatchObject({
      access: 'locked',
      status: 'inactive',
      source: null,
    });
    expect(
      findProduct(response.products, PlatformProductKey.LeadFlow).access,
    ).toBe('available');
  });

  describe('managed context (LF-RF-F12-001)', () => {
    it('lists the authorized contexts per client-scoped product', async () => {
      const { service, managedContextDirectory } = createService({
        entitlements: [
          makeEntitlement(
            PlatformProductKey.LeadFlow,
            ProductEntitlementStatus.Active,
          ),
        ],
      });

      const response = await service.getContext(contextInput);

      expect(Object.keys(response.managedContext.available).sort()).toEqual([
        'leadflow',
        'social',
      ]);
      expect(response.managedContext.available.leadflow.agency.available).toBe(
        true,
      );
      expect(response.managedContext.available.social.agency.available).toBe(
        false,
      );
      expect(managedContextDirectory.listAuthorizedClients).toHaveBeenCalledWith(
        {
          tenantId: contextInput.tenantId,
          workspaceId: contextInput.workspaceId,
          userId: contextInput.userId,
          role: contextInput.role,
        },
        'leadflow',
      );
    });

    it('reports the context the server accepted, not the one requested', async () => {
      const { service, managedContextDirectory } = createService();

      managedContextDirectory.resolveActiveContext.mockResolvedValue({
        active: {
          kind: 'agency',
          productKey: 'leadflow',
          clientId: null,
          managedTenantId: null,
          displayName: null,
        },
        requested: {
          productKey: 'leadflow',
          operatingMode: 'client',
          clientId: 'client-from-another-tenant',
        },
        rejection: {
          code: 'context_not_authorized',
          requestedClientId: 'client-from-another-tenant',
          requestedProductKey: 'leadflow',
        },
      });

      const response = await service.getContext({
        ...contextInput,
        requestedContext: {
          productKey: 'leadflow',
          operatingMode: 'client',
          clientId: 'client-from-another-tenant',
        },
      });

      expect(response.managedContext.active.kind).toBe('agency');
      expect(response.managedContext.rejection?.code).toBe(
        'context_not_authorized',
      );
    });

    it('marks modules of a locked product as unavailable', async () => {
      const { service } = createService({
        entitlements: [
          makeEntitlement(
            PlatformProductKey.LeadFlow,
            ProductEntitlementStatus.Active,
          ),
        ],
      });

      const response = await service.getContext(contextInput);

      expect(response.modules['leadflow.inbox']).toEqual({
        key: 'leadflow.inbox',
        productKey: PlatformProductKey.LeadFlow,
        available: true,
      });
      expect(response.modules['social.planner'].available).toBe(false);
      expect(response.modules['agency.finance'].available).toBe(false);
    });
  });
});
