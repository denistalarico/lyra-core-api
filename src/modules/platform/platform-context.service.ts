import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ManagedContextDirectoryService } from '../../common/context/managed-context-directory.service';
import {
  MANAGED_CLIENT_PRODUCT_KEYS,
  type ManagedClientProductKey,
  type RequestedManagedContext,
} from '../../common/context/managed-context.contract';
import {
  getProductModuleKeys,
  isPlatformProductKey,
  PLATFORM_PRODUCT_KEYS,
} from './catalog/platform-products.catalog';
import { PlatformAccountEntity } from './entities/platform-account.entity';
import { TenantProductEntitlementEntity } from './entities/tenant-product-entitlement.entity';
import {
  PlatformProductKey,
  ProductEntitlementSource,
  ProductEntitlementStatus,
} from './enums/platform-product.enums';
import type {
  PlatformContextModule,
  PlatformContextProduct,
  PlatformContextProductContexts,
  PlatformContextProductStatus,
  PlatformContextResponse,
  PlatformManagedContext,
} from './types/platform-context.types';

const AGENCY_CONNECTION = 'agency';

const EMPTY_REQUESTED_CONTEXT: RequestedManagedContext = {
  productKey: null,
  operatingMode: null,
  clientId: null,
};

type PlatformContextInput = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  role: string;
  /**
   * Context the caller asked for, read from request headers. Optional so
   * non-HTTP callers (workers, other services) still get a valid agency
   * context instead of having to fake headers.
   */
  requestedContext?: RequestedManagedContext;
};

@Injectable()
export class PlatformContextService {
  constructor(
    @InjectRepository(TenantProductEntitlementEntity, AGENCY_CONNECTION)
    private readonly entitlementsRepository: Repository<TenantProductEntitlementEntity>,
    @InjectRepository(PlatformAccountEntity, AGENCY_CONNECTION)
    private readonly platformAccountsRepository: Repository<PlatformAccountEntity>,
    private readonly configService: ConfigService,
    private readonly managedContextDirectory: ManagedContextDirectoryService,
  ) {}

  async getContext(
    input: PlatformContextInput,
  ): Promise<PlatformContextResponse> {
    const requestedContext = input.requestedContext ?? EMPTY_REQUESTED_CONTEXT;

    const [entitlements, account] = await Promise.all([
      this.entitlementsRepository.find({
        where: { tenantId: input.tenantId },
        order: { productKey: 'ASC' },
      }),
      this.platformAccountsRepository.findOne({
        where: { tenantId: input.tenantId },
      }),
    ]);

    const products =
      entitlements.length === 0
        ? this.buildProductsWithCompatibilityFallback()
        : this.buildProductsFromEntitlements(entitlements);

    const managedContext = await this.buildManagedContext(
      input,
      requestedContext,
      products,
    );

    return {
      account: {
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        type: account?.accountType ?? 'unknown',
        status: account?.status ?? 'unknown',
        displayName: account?.displayName ?? null,
        onboardingMode: account?.onboardingMode ?? null,
      },
      user: {
        id: input.userId,
        role: input.role,
      },
      products,
      modules: this.buildModules(products),
      managedContext,
    };
  }

  /**
   * Resolves the shell contract: which contexts the caller may operate per
   * client-scoped product, and which one this request is actually in
   * (LF-RF-F12-001). Both answers come from
   * {@link ManagedContextDirectoryService} — the same code the permission
   * guard enforces with — so the switcher can never offer a context the
   * guard would refuse.
   */
  private async buildManagedContext(
    input: PlatformContextInput,
    requestedContext: RequestedManagedContext,
    products: PlatformContextProduct[],
  ): Promise<PlatformManagedContext> {
    const identity = {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: input.role,
    };

    const [resolution, ...availabilityEntries] = await Promise.all([
      this.managedContextDirectory.resolveActiveContext(
        identity,
        requestedContext,
      ),
      ...MANAGED_CLIENT_PRODUCT_KEYS.map(async (productKey) => {
        const clients = await this.managedContextDirectory.listAuthorizedClients(
          identity,
          productKey,
        );

        return [
          productKey,
          {
            agency: {
              available: this.isProductAvailable(products, productKey),
            },
            clients,
          },
        ] as [ManagedClientProductKey, PlatformContextProductContexts];
      }),
    ]);

    return {
      active: resolution.active,
      requested: resolution.requested,
      rejection: resolution.rejection,
      available: Object.fromEntries(availabilityEntries) as Record<
        ManagedClientProductKey,
        PlatformContextProductContexts
      >,
    };
  }

  private isProductAvailable(
    products: PlatformContextProduct[],
    productKey: string,
  ): boolean {
    return (
      products.find((product) => product.key === productKey)?.access ===
      'available'
    );
  }

  private buildModules(
    products: PlatformContextProduct[],
  ): Record<string, PlatformContextModule> {
    const modules: Record<string, PlatformContextModule> = {};

    for (const productKey of PLATFORM_PRODUCT_KEYS) {
      const available = this.isProductAvailable(products, productKey);

      for (const moduleKey of getProductModuleKeys(productKey)) {
        modules[moduleKey] = { key: moduleKey, productKey, available };
      }
    }

    return modules;
  }

  private buildProductsWithCompatibilityFallback(): PlatformContextProduct[] {
    const fallbackProduct = this.configService.get<string>(
      'PLATFORM_COMPATIBILITY_DEFAULT_PRODUCT',
    );

    return PLATFORM_PRODUCT_KEYS.map((productKey) => {
      if (fallbackProduct && isPlatformProductKey(fallbackProduct)) {
        if (productKey === fallbackProduct) {
          return {
            key: productKey,
            status: 'active',
            access: 'available',
            source: ProductEntitlementSource.Compatibility,
            planKey: null,
            trialEndsAt: null,
            endsAt: null,
          };
        }
      }

      return this.buildLockedProduct(productKey);
    });
  }

  private buildProductsFromEntitlements(
    entitlements: TenantProductEntitlementEntity[],
  ): PlatformContextProduct[] {
    const entitlementsByProduct = new Map<
      PlatformProductKey,
      TenantProductEntitlementEntity
    >();

    for (const entitlement of entitlements) {
      if (isPlatformProductKey(entitlement.productKey)) {
        entitlementsByProduct.set(entitlement.productKey, entitlement);
      }
    }

    return PLATFORM_PRODUCT_KEYS.map((productKey) => {
      const entitlement = entitlementsByProduct.get(productKey);

      if (!entitlement) {
        return this.buildLockedProduct(productKey);
      }

      return this.buildProductFromEntitlement(entitlement);
    });
  }

  private buildProductFromEntitlement(
    entitlement: TenantProductEntitlementEntity,
  ): PlatformContextProduct {
    const status = this.resolveResponseStatus(entitlement);
    const available =
      status === ProductEntitlementStatus.Active ||
      status === ProductEntitlementStatus.Trial;

    return {
      key: entitlement.productKey,
      status,
      access: available ? 'available' : 'locked',
      source: entitlement.source,
      planKey: entitlement.planKey,
      trialEndsAt: this.toIsoString(entitlement.trialEndsAt),
      endsAt: this.toIsoString(entitlement.endsAt),
    };
  }

  private resolveResponseStatus(
    entitlement: TenantProductEntitlementEntity,
  ): PlatformContextProductStatus {
    const now = new Date();
    const endsAtExpired = this.hasExpired(entitlement.endsAt, now);

    if (entitlement.status === ProductEntitlementStatus.Active) {
      return endsAtExpired
        ? ProductEntitlementStatus.Expired
        : ProductEntitlementStatus.Active;
    }

    if (entitlement.status === ProductEntitlementStatus.Trial) {
      const trialExpired = this.hasExpired(entitlement.trialEndsAt, now);
      return trialExpired || endsAtExpired
        ? ProductEntitlementStatus.Expired
        : ProductEntitlementStatus.Trial;
    }

    return entitlement.status;
  }

  private hasExpired(value: Date | null, now: Date): boolean {
    return value !== null && value.getTime() <= now.getTime();
  }

  private buildLockedProduct(
    productKey: PlatformProductKey,
  ): PlatformContextProduct {
    return {
      key: productKey,
      status: 'inactive',
      access: 'locked',
      source: null,
      planKey: null,
      trialEndsAt: null,
      endsAt: null,
    };
  }

  private toIsoString(value: Date | null): string | null {
    return value ? value.toISOString() : null;
  }
}
