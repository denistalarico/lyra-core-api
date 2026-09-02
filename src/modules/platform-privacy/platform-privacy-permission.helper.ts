// src/modules/platform-privacy/platform-privacy-permission.helper.ts
//
// Product-bound permission resolution for the neutral telemetry routes
// (Lyra Social S1.4.8 §13).
//
// Same pattern as `resolveBusinessProfilePermissionKey` (S1.4.0) and
// `resolveClientProductAccessPermissionKey` (S1.4.7 pointed correction):
// the endpoint is neutral of product, the authorization is not. A caller
// operating as `x-lyra-product-key: social` must hold the Social telemetry
// key; a caller operating as `leadflow` must hold the LeadFlow one. Holding
// only the other product's key is never enough — no OR across products.
//
// `@RequireAnyPermission` metadata is static per route, so it cannot pick
// the key from a productKey that only exists once `OperationalContextResolver`
// has run inside the guard. It stays on the route to force `PermissionsGuard`
// to run (which is also what applies the D-15 entitlement fence); the binding
// decision is made at runtime against the key this helper returns.

import { ForbiddenException } from '@nestjs/common';
import type { ProductKey } from '../../common/context/request-context.interface';

export type TelemetryVerb = 'view' | 'manage';

const PERMISSION_KEY_BY_PRODUCT: Record<
  Exclude<ProductKey, 'agency'>,
  Record<TelemetryVerb, string>
> = {
  leadflow: {
    view: 'leadflow.settings.telemetry.view.admin',
    manage: 'leadflow.settings.telemetry.manage.owner_only',
  },
  social: {
    view: 'social.settings.telemetry.view.admin',
    manage: 'social.settings.telemetry.manage.owner_only',
  },
};

export const TELEMETRY_VIEW_PERMISSIONS = [
  PERMISSION_KEY_BY_PRODUCT.leadflow.view,
  PERMISSION_KEY_BY_PRODUCT.social.view,
];

export const TELEMETRY_MANAGE_PERMISSIONS = [
  PERMISSION_KEY_BY_PRODUCT.leadflow.manage,
  PERMISSION_KEY_BY_PRODUCT.social.manage,
];

/**
 * The single permission key that authorizes `verb` for the caller's resolved
 * `productKey`. `'agency'` (the platform shell itself, no product asking) has
 * no product-specific telemetry permission to bind to, so it is rejected
 * rather than silently allowed through an unrelated key.
 */
export function resolveTelemetryPermissionKey(
  productKey: ProductKey | undefined,
  verb: TelemetryVerb,
): string {
  if (productKey === 'leadflow' || productKey === 'social') {
    return PERMISSION_KEY_BY_PRODUCT[productKey][verb];
  }

  throw new ForbiddenException(
    'A product context (x-lyra-product-key: leadflow or social) is required to access telemetry privacy settings.',
  );
}
