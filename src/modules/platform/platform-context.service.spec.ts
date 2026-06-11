import { ConfigService } from '@nestjs/config';
import { PlatformProductKey } from './enums/platform-product.enums';
import { PlatformContextService } from './platform-context.service';
import type { TenantProductEntitlementEntity } from './entities/tenant-product-entitlement.entity';
import {
  ProductEntitlementSource,
  ProductEntitlementStatus,
} from './enums/platform-product.enums';

type EntitlementRepositoryMock = {
  find: jest.Mock<Promise<TenantProductEntitlementEntity[]>, [unknown]>;
};

function createService(options?: {
  fallbackProduct?: string;
  entitlements?: TenantProductEntitlementEntity[];
}) {
  const repository: EntitlementRepositoryMock = {
    find: jest.fn().mockResolvedValue(options?.entitlements ?? []),
  };
  const configService = {
    get: jest.fn((key: string) =>
      key === 'PLATFORM_COMPATIBILITY_DEFAULT_PRODUCT'
        ? options?.fallbackProduct
        : undefined,
    ),
  } as Pick<ConfigService, 'get'> as ConfigService;

  return {
    service: new PlatformContextService(repository as never, configService),
    repository,
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
});
