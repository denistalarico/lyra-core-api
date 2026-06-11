import {
  PlatformAccountStatus,
  PlatformAccountType,
  PlatformOnboardingMode,
} from '../enums/platform-account.enums';
import {
  PlatformProductKey,
  ProductEntitlementSource,
} from '../enums/platform-product.enums';

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
  modules: Record<string, never>;
  managedContext: null;
};
