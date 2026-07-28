export const PLATFORM_ADMIN_STATUSES = [
  'pending',
  'active',
  'suspended',
  'disabled',
] as const;

export type PlatformAdminStatus = (typeof PLATFORM_ADMIN_STATUSES)[number];

export const PLATFORM_ADMIN_ROLE_KEYS = [
  'super_admin',
  'admin',
  'support_admin',
  'billing_admin',
  'operations_admin',
  'read_only',
] as const;

export type PlatformAdminRoleKey = (typeof PLATFORM_ADMIN_ROLE_KEYS)[number];

export const PLATFORM_ADMIN_ROLE_PRIORITY: Readonly<
  Record<PlatformAdminRoleKey, number>
> = Object.freeze({
  super_admin: 600,
  admin: 500,
  operations_admin: 400,
  billing_admin: 300,
  support_admin: 300,
  read_only: 100,
});

export const PLATFORM_ADMIN_PERMISSIONS = [
  'admin.access',
  'admin.settings.read',
  'admin.settings.update',
  'admin.internal_users.read',
  'admin.internal_users.create',
  'admin.internal_users.update',
  'admin.internal_users.disable',
  'admin.roles.read',
  'admin.roles.manage',
  'admin.security.read',
  'admin.security.manage',
  'admin.sessions.read',
  'admin.sessions.revoke',
  'admin.audit.read',
] as const;

export type PlatformAdminPermission =
  (typeof PLATFORM_ADMIN_PERMISSIONS)[number];

export const PLANNED_PLATFORM_ADMIN_NAMESPACES = [
  'admin.customers.*',
  'admin.billing.*',
  'admin.support.*',
  'admin.communications.*',
  'admin.operations.*',
  'admin.platform.*',
  'admin.sites.*',
] as const;

export type PlannedPlatformAdminNamespace =
  (typeof PLANNED_PLATFORM_ADMIN_NAMESPACES)[number];

export const PLATFORM_ADMIN_NAMESPACE_CONTRACT = Object.freeze(
  PLANNED_PLATFORM_ADMIN_NAMESPACES.map((namespace) => ({
    namespace,
    status: 'planned' as const,
  })),
);

const BASE_SPECIALIZED_PERMISSIONS = [
  'admin.access',
  'admin.settings.read',
  'admin.internal_users.read',
] as const satisfies readonly PlatformAdminPermission[];

const READ_ONLY_PERMISSIONS = PLATFORM_ADMIN_PERMISSIONS.filter(
  (permission) => permission === 'admin.access' || permission.endsWith('.read'),
);

export const PLATFORM_ADMIN_ROLE_PERMISSIONS: Readonly<
  Record<PlatformAdminRoleKey, readonly PlatformAdminPermission[]>
> = Object.freeze({
  super_admin: PLATFORM_ADMIN_PERMISSIONS,
  admin: PLATFORM_ADMIN_PERMISSIONS.filter(
    (permission) =>
      permission !== 'admin.roles.manage' &&
      permission !== 'admin.security.manage',
  ),
  support_admin: BASE_SPECIALIZED_PERMISSIONS,
  billing_admin: BASE_SPECIALIZED_PERMISSIONS,
  operations_admin: [...BASE_SPECIALIZED_PERMISSIONS, 'admin.audit.read'],
  read_only: READ_ONLY_PERMISSIONS,
});

export type AdminPrincipal = {
  adminId: string;
  userId: string | null;
  identityTenantId: string | null;
  platformAdminIdentityId?: string | null;
  identitySource?: 'agency' | 'platform_admin';
  subjectId?: string;
  email: string;
  displayName: string;
  roleKey: PlatformAdminRoleKey;
  permissions: readonly PlatformAdminPermission[];
  sessionId: string;
  sessionContext: 'admin';
};

export type AdminAuthTokenPayload = {
  sub: string;
  adminId: string;
  identitySource?: 'agency' | 'platform_admin';
  identityTenantId: string | null;
  platformAdminIdentityId?: string | null;
  sessionId: string;
  email: string;
  roleKey: PlatformAdminRoleKey;
  sessionContext: 'admin';
};

export type AdminTwoFactorMethod = 'authenticator' | 'email';

export type AdminTwoFactorTokenPayload = {
  sub: string;
  adminId: string;
  identitySource?: 'agency' | 'platform_admin';
  identityTenantId: string | null;
  platformAdminIdentityId?: string | null;
  email: string;
  roleKey: PlatformAdminRoleKey;
  flow: 'login' | 'setup';
  method?: AdminTwoFactorMethod;
  sessionContext: 'admin-2fa';
};

export function isPlatformAdminStatus(
  value: unknown,
): value is PlatformAdminStatus {
  return PLATFORM_ADMIN_STATUSES.includes(value as PlatformAdminStatus);
}

export function isPlatformAdminRoleKey(
  value: unknown,
): value is PlatformAdminRoleKey {
  return PLATFORM_ADMIN_ROLE_KEYS.includes(value as PlatformAdminRoleKey);
}

export function isPlatformAdminRoleDowngrade(
  currentRole: PlatformAdminRoleKey,
  requestedRole: PlatformAdminRoleKey,
): boolean {
  return (
    PLATFORM_ADMIN_ROLE_PRIORITY[requestedRole] <
    PLATFORM_ADMIN_ROLE_PRIORITY[currentRole]
  );
}

export function isPlatformAdminPermission(
  value: unknown,
): value is PlatformAdminPermission {
  return PLATFORM_ADMIN_PERMISSIONS.includes(value as PlatformAdminPermission);
}
