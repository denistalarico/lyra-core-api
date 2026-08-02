import {
  ClientAccessLevel,
  ClientProductRoleKey,
} from '../enums/permission.enums';
import {
  ProductEntitlementSource,
  ProductEntitlementStatus,
} from '../../platform';

/**
 * Minimal context required to resolve permissions. Mirrors RequestContext
 * but keeps the permissions module decoupled from the auth/context modules.
 */
export interface PermissionContext {
  tenantId: string;
  workspaceId?: string;
  userId: string;
  role: string;
}

export interface PermissionScopeRequest {
  method?: string;
  routePath?: string | null;
  params?: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown> | null;
}

export interface ClientAccessCheck extends PermissionContext {
  clientId: string;
  requiredLevel?: ClientAccessLevel;
}

export interface ClientProductAccessCheck extends PermissionContext {
  clientId: string;
  productKey: string;
  requiredRole?: ClientProductRoleKey;
}

/**
 * A managed client the caller is authorized to operate a given product in:
 * active client, active product entitlement on the managed tenant and
 * (unless the caller is owner/admin) an explicit client + client-product
 * access grant for the caller (blueprint sections 8.3, 9.6 and 12.6).
 */
export interface AuthorizedManagedClientEntry {
  clientId: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  managedTenantId: string;
  entitlement: {
    status: ProductEntitlementStatus;
    planKey: string | null;
    source: ProductEntitlementSource;
    startsAt: string | null;
    endsAt: string | null;
    trialEndsAt: string | null;
  };
}

export interface PermissionAuditDecision {
  tenantId: string;
  workspaceId?: string | null;
  actorUserId?: string | null;
  targetUserId?: string | null;
  action: string;
  permissionKey?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  riskLevel?: string | null;
  metadata?: Record<string, unknown>;
}
