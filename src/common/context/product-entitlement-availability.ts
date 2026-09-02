import { TenantProductEntitlementEntity } from '../../modules/platform/entities/tenant-product-entitlement.entity';
import { ProductEntitlementStatus } from '../../modules/platform/enums/platform-product.enums';

const AVAILABLE_ENTITLEMENT_STATUSES = new Set<ProductEntitlementStatus>([
  ProductEntitlementStatus.Active,
  ProductEntitlementStatus.Trial,
]);

type ProductEntitlementAvailability = Pick<
  TenantProductEntitlementEntity,
  'status' | 'startsAt' | 'endsAt' | 'trialEndsAt'
>;

/**
 * Canonical operational availability rule for a product entitlement.
 *
 * Keep this helper independent from caller permissions: it answers only
 * whether the contracted product is available inside its lifecycle window.
 */
export function isActiveProductEntitlement(
  entitlement: ProductEntitlementAvailability | null | undefined,
  now = new Date(),
): boolean {
  if (!entitlement || !AVAILABLE_ENTITLEMENT_STATUSES.has(entitlement.status)) {
    return false;
  }

  if (entitlement.startsAt && entitlement.startsAt > now) {
    return false;
  }

  if (entitlement.endsAt && entitlement.endsAt <= now) {
    return false;
  }

  if (
    entitlement.status === ProductEntitlementStatus.Trial &&
    entitlement.trialEndsAt &&
    entitlement.trialEndsAt <= now
  ) {
    return false;
  }

  return true;
}
