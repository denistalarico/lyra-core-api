import { PlatformRoleKey } from '../enums/permission.enums';
import {
  PERMISSION_DEFINITIONS,
  type PermissionDefinition,
} from './permission-keys.catalog';

/**
 * Simplified access model (Settings > Users, 2026-11).
 *
 * Owner and Admin hold every catalog key their role lists. Manager and Member
 * get a level per product/module instead of per-key overrides:
 * - `agency` is a product switch: blocked hides the whole Agency product.
 * - each Agency module has a level (`manager` | `member`) or no access.
 * - `leadflow` / `social` carry the user's level in that product; which
 *   managed clients they reach is `agency_client_product_access`.
 *
 * A level never exceeds the role: a Member is always `member`.
 * The keys a level grants are the catalog keys whose `roles` include that
 * level's role, so the catalog stays the single source of truth.
 */
export type ModuleAccessLevel = 'manager' | 'member';
export type StoredModuleAccess = ModuleAccessLevel | 'blocked' | 'full' | 'partial';

export const AGENCY_ACCESS_MODULES = [
  'dashboard',
  'messages',
  'projects',
  'calendar',
  'sales',
  'knowledge',
  'contacts',
  'clients',
  'contracts',
  'finance',
  'team',
] as const;
export type AgencyAccessModule = (typeof AGENCY_ACCESS_MODULES)[number];

export const ACCESS_PRODUCTS = ['agency', 'leadflow', 'social'] as const;
export type AccessProduct = (typeof ACCESS_PRODUCTS)[number];

export const ACCESS_KEYS: readonly string[] = [
  ...ACCESS_PRODUCTS,
  ...AGENCY_ACCESS_MODULES,
];

const MEMBER_DEFAULT_MODULES = new Set<AgencyAccessModule>([
  'dashboard',
  'messages',
  'projects',
  'calendar',
  'sales',
  'knowledge',
  'contacts',
]);
const MANAGER_DEFAULT_OFF = new Set<AgencyAccessModule>(['finance', 'team']);

const AGENCY_MODULE_BY_CATALOG_MODULE: Record<string, AgencyAccessModule> = {
  dashboards: 'dashboard',
  chat: 'messages',
  client_conversations: 'messages',
  projects: 'projects',
  tasks: 'projects',
  calendar: 'calendar',
  sales: 'sales',
  knowledge: 'knowledge',
  clients: 'clients',
  client_area: 'clients',
  contracts: 'contracts',
  finance: 'finance',
  team: 'team',
};

/**
 * The access key that gates a catalog key, or `null` when it follows the role
 * alone (Agency Settings: profile/security for everyone, the rest Admin+).
 */
export function resolveAccessKey(
  definition: Pick<PermissionDefinition, 'productKey' | 'moduleKey'>,
): string | null {
  if (definition.productKey === 'shared' && definition.moduleKey === 'contacts')
    return 'contacts';
  if (definition.productKey === 'leadflow') return 'leadflow';
  if (definition.productKey === 'social') return 'social';
  if (definition.productKey === 'agency')
    return AGENCY_MODULE_BY_CATALOG_MODULE[definition.moduleKey] ?? null;
  return null;
}

export function isModuleScopedRole(role: PlatformRoleKey): boolean {
  return role === PlatformRoleKey.Manager || role === PlatformRoleKey.Member;
}

function roleLevel(role: PlatformRoleKey): ModuleAccessLevel {
  return role === PlatformRoleKey.Manager ? 'manager' : 'member';
}

function defaultLevel(
  role: PlatformRoleKey,
  key: string,
): ModuleAccessLevel | null {
  if (key === 'agency' || key === 'leadflow' || key === 'social')
    return roleLevel(role);
  const module = key as AgencyAccessModule;
  if (role === PlatformRoleKey.Manager)
    return MANAGER_DEFAULT_OFF.has(module) ? null : 'manager';
  return MEMBER_DEFAULT_MODULES.has(module) ? 'member' : null;
}

function storedLevel(
  role: PlatformRoleKey,
  access: string,
): ModuleAccessLevel | null {
  if (access === 'blocked') return null;
  // `full` is the legacy app-access value; it means "the role's own level".
  if (access === 'manager' || access === 'full') return roleLevel(role);
  return 'member';
}

/**
 * Resolves the level for every access key. Stored rows win over the role
 * defaults; a level is clamped to the role; Agency modules are off when the
 * Agency product is off. Owner/Admin get `manager` everywhere.
 */
export function resolveModuleAccess(
  role: PlatformRoleKey,
  rows: ReadonlyArray<{ appKey: string; access: string }>,
): Record<string, ModuleAccessLevel | null> {
  const stored = new Map(rows.map((row) => [row.appKey, row.access]));
  const levels: Record<string, ModuleAccessLevel | null> = {};

  for (const key of ACCESS_KEYS) {
    if (!isModuleScopedRole(role)) {
      levels[key] = 'manager';
      continue;
    }
    const access = stored.get(key);
    levels[key] =
      access === undefined ? defaultLevel(role, key) : storedLevel(role, access);
  }

  if (isModuleScopedRole(role) && levels.agency === null) {
    for (const module of AGENCY_ACCESS_MODULES) levels[module] = null;
  }

  return levels;
}

/** Catalog keys a Manager/Member holds given their resolved levels. */
export function permissionsForModuleAccess(
  role: PlatformRoleKey,
  levels: Record<string, ModuleAccessLevel | null>,
): string[] {
  return PERMISSION_DEFINITIONS.filter((definition) => {
    const accessKey = resolveAccessKey(definition);
    if (accessKey === null) return definition.roles.includes(role);
    const level = levels[accessKey];
    if (!level) return false;
    return definition.roles.includes(
      level === 'manager' ? PlatformRoleKey.Manager : PlatformRoleKey.Member,
    );
  }).map((definition) => definition.key);
}
