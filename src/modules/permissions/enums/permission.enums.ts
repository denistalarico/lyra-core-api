export enum PlatformRoleKey {
  Owner = 'owner',
  Admin = 'admin',
  Manager = 'manager',
  Member = 'member',
}

export const PLATFORM_ROLE_KEYS = Object.values(PlatformRoleKey);

export enum PermissionRiskLevel {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Critical = 'critical',
}

export enum PermissionScopeKey {
  Self = 'self',
  Assigned = 'assigned',
  CreatedByMe = 'created_by_me',
  Own = 'own',
  Department = 'department',
  Client = 'client',
  ClientProduct = 'client_product',
  Workspace = 'workspace',
  Tenant = 'tenant',
  All = 'all',
  OwnerOnly = 'owner_only',
}

/**
 * Client visibility tiers from the permissions blueprint (section 9.6).
 * Each tier is a superset of the previous one.
 */
export enum ClientAccessLevel {
  Basic = 'basic',
  Relationship = 'relationship',
  Business = 'business',
  Admin = 'admin',
}

export const CLIENT_ACCESS_LEVEL_ORDER: ClientAccessLevel[] = [
  ClientAccessLevel.Basic,
  ClientAccessLevel.Relationship,
  ClientAccessLevel.Business,
  ClientAccessLevel.Admin,
];

/**
 * Products that can be enabled per managed client (blueprint section 8.3 / 12.6).
 */
export enum ClientProductKey {
  LeadFlow = 'leadflow',
  Social = 'social',
}

/**
 * Role a user holds within a specific client's product (blueprint section 12.6).
 */
export enum ClientProductRoleKey {
  Owner = 'owner',
  Admin = 'admin',
  Manager = 'manager',
  Member = 'member',
  Viewer = 'viewer',
}

export const CLIENT_PRODUCT_ROLE_ORDER: ClientProductRoleKey[] = [
  ClientProductRoleKey.Viewer,
  ClientProductRoleKey.Member,
  ClientProductRoleKey.Manager,
  ClientProductRoleKey.Admin,
  ClientProductRoleKey.Owner,
];

export enum PermissionAuditAction {
  RoleAssigned = 'role_assigned',
  RoleRemoved = 'role_removed',
  PermissionGranted = 'permission_granted',
  PermissionRevoked = 'permission_revoked',
  ClientAccessGranted = 'client_access_granted',
  ClientAccessRevoked = 'client_access_revoked',
  ClientProductAccessGranted = 'client_product_access_granted',
  ClientProductAccessRevoked = 'client_product_access_revoked',
  DangerousActionExecuted = 'dangerous_action_executed',
  AccessDenied = 'access_denied',
}
