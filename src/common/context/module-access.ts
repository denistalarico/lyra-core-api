/**
 * Settings > Users: Owner/Admin, or a user whose level in the given module is
 * `manager`, sees and acts on the whole module. Everyone else is narrowed to
 * their own records by each service.
 *
 * `moduleAccess` is set by the PermissionsGuard on the request and copied
 * into `RequestContext`; when it is absent the caller is treated as narrowed.
 */
export function hasModuleWideAccess(
  context: {
    role?: string | null;
    moduleAccess?: Record<string, 'manager' | 'member' | null>;
  },
  moduleKey: string,
): boolean {
  const role = context.role;
  if (role === 'owner' || role === 'admin' || role === 'administrator') {
    return true;
  }
  return context.moduleAccess?.[moduleKey] === 'manager';
}
