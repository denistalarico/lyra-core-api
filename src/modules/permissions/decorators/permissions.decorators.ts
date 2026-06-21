import { SetMetadata } from '@nestjs/common';
import {
  ClientAccessLevel,
  ClientProductRoleKey,
} from '../enums/permission.enums';

export const PERMISSION_KEY_METADATA = 'permissions:permission_key';
export const ANY_PERMISSION_KEYS_METADATA = 'permissions:any_permission_keys';
export const PRODUCT_ENTITLEMENT_METADATA = 'permissions:product_entitlement';
export const CLIENT_ACCESS_METADATA = 'permissions:client_access';
export const CLIENT_PRODUCT_ACCESS_METADATA =
  'permissions:client_product_access';
export const DANGEROUS_ACTION_METADATA = 'permissions:dangerous_action';

/**
 * Requires the caller to hold the given permission key
 * (blueprint section 14). Combine with {@link PermissionsGuard}.
 */
export const RequirePermission = (permissionKey: string) =>
  SetMetadata(PERMISSION_KEY_METADATA, permissionKey);

/**
 * Requires the caller to hold at least one of the given permission keys.
 * Useful for self/department/admin alternatives on the same endpoint.
 */
export const RequireAnyPermission = (...permissionKeys: string[]) =>
  SetMetadata(ANY_PERMISSION_KEYS_METADATA, permissionKeys);

/**
 * Requires the tenant to have an active entitlement for the given product
 * (blueprint sections 6.4 and 14).
 */
export const RequireProductEntitlement = (productKey: string) =>
  SetMetadata(PRODUCT_ENTITLEMENT_METADATA, productKey);

export interface RequireClientAccessOptions {
  /** Minimum client visibility tier (blueprint section 9.6). */
  level?: ClientAccessLevel;
  /** Route param holding the client id. Defaults to `clientId`. */
  param?: string;
}

/**
 * Requires the caller to have access to the client identified by a route
 * param, optionally at a minimum visibility tier (blueprint section 8.2).
 */
export const RequireClientAccess = (options: RequireClientAccessOptions = {}) =>
  SetMetadata(CLIENT_ACCESS_METADATA, {
    level: options.level,
    param: options.param ?? 'clientId',
  });

export interface RequireClientProductAccessOptions {
  productKey: string;
  /** Minimum role required within the client's product. */
  role?: ClientProductRoleKey;
  /** Route param holding the client id. Defaults to `clientId`. */
  param?: string;
}

/**
 * Requires the caller to have access to a product (LeadFlow, Social, ...)
 * contracted by the client identified by a route param
 * (blueprint section 8.3).
 */
export const RequireClientProductAccess = (
  options: RequireClientProductAccessOptions,
) =>
  SetMetadata(CLIENT_PRODUCT_ACCESS_METADATA, {
    productKey: options.productKey,
    role: options.role,
    param: options.param ?? 'clientId',
  });

/**
 * Marks an endpoint as a Danger Zone action. The guard records an audit
 * event for every execution, regardless of outcome (blueprint section 17).
 */
export const DangerousAction = () =>
  SetMetadata(DANGEROUS_ACTION_METADATA, true);
