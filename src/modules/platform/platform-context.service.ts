import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
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
  PlatformContextProduct,
  PlatformContextProductStatus,
  PlatformContextResponse,
} from './types/platform-context.types';

const AGENCY_CONNECTION = 'agency';

type PlatformContextInput = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  role: string;
};

@Injectable()
export class PlatformContextService {
  constructor(
    @InjectRepository(TenantProductEntitlementEntity, AGENCY_CONNECTION)
    private readonly entitlementsRepository: Repository<TenantProductEntitlementEntity>,
    @InjectRepository(PlatformAccountEntity, AGENCY_CONNECTION)
    private readonly platformAccountsRepository: Repository<PlatformAccountEntity>,
    private readonly configService: ConfigService,
  ) {}

  async getContext(
    input: PlatformContextInput,
  ): Promise<PlatformContextResponse> {
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
      modules: {},
      managedContext: null,
    };
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
