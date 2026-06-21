import {
  ClientAccessLevel,
  ClientProductRoleKey,
} from '../enums/permission.enums';

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
