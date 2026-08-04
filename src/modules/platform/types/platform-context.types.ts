import type {
  ActiveManagedContext,
  AuthorizedManagedClient,
  ManagedClientProductKey,
  ManagedContextRejection,
  RequestedManagedContext,
} from '../../../common/context/managed-context.contract';
import {
  PlatformAccountStatus,
  PlatformAccountType,
  PlatformOnboardingMode,
} from '../enums/platform-account.enums';
import {
  PlatformProductKey,
  ProductEntitlementSource,
} from '../enums/platform-product.enums';
import type { PlatformModuleKey } from '../catalog/platform-products.catalog';

export type ProductAccessState = 'available' | 'locked';

export type PlatformContextProductStatus =
  | 'active'
  | 'trial'
  | 'suspended'
  | 'expired'
  | 'cancelled'
  | 'inactive';

export type PlatformContextProduct = {
  key: PlatformProductKey;
  status: PlatformContextProductStatus;
  access: ProductAccessState;
  source: ProductEntitlementSource | 'compatibility' | null;
  planKey: string | null;
  trialEndsAt: string | null;
  endsAt: string | null;
};

/**
 * A module of a product, and whether the current context may reach it. A
 * module is available only when its product is available: the map never
 * grants more than the entitlement does.
 */
export type PlatformContextModule = {
  key: PlatformModuleKey;
  productKey: PlatformProductKey;
  available: boolean;
};

/**
 * Contexts available for one client-scoped product (LF-RF-F12-001).
 */
export type PlatformContextProductContexts = {
  agency: { available: boolean };
  clients: AuthorizedManagedClient[];
};

/**
 * The active-context contract the shell consumes. `active` is what the
 * server accepted for this request — never what the browser asked for.
 */
export type PlatformManagedContext = {
  active: ActiveManagedContext;
  requested: RequestedManagedContext;
  rejection: ManagedContextRejection | null;
  available: Record<ManagedClientProductKey, PlatformContextProductContexts>;
};

export type PlatformContextResponse = {
  account: {
    tenantId: string;
    workspaceId: string;
    type: PlatformAccountType | 'unknown';
    status: PlatformAccountStatus | 'unknown';
    displayName: string | null;
    onboardingMode: PlatformOnboardingMode | null;
  };
  user: {
    id: string;
    role: string;
  };
  products: PlatformContextProduct[];
  modules: Record<string, PlatformContextModule>;
  managedContext: PlatformManagedContext;
};
