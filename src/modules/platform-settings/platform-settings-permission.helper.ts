// src/modules/platform-settings/platform-settings-permission.helper.ts
//
// The endpoint is neutral of product, but authorization is not
// interchangeable between products (S1.4.0 pre-commit review). A caller
// operating as `x-lyra-product-key: social` must hold the Social permission;
// a caller operating as `leadflow` must hold the LeadFlow one. Holding only
// the other product's permission is not enough, even though both keys grant
// the same verb on the same shared row.
//
// `PermissionsGuard`'s `@RequireAnyPermission` metadata is static per route,
// so it cannot alone express "pick the permission key based on this
// request's resolved productKey" — that decision only exists once
// `OperationalContextResolver` has already run inside the guard. This
// module supplies the per-productKey key, and the controller asserts it at
// runtime via the same `PlatformPermissionService` the guard itself uses —
// not a parallel authorization system.

import { ForbiddenException } from '@nestjs/common';
import type { ProductKey } from '../../common/context/request-context.interface';

export type BusinessProfileVerb = 'view' | 'update';

const PERMISSION_KEY_BY_PRODUCT: Record<
  Exclude<ProductKey, 'agency'>,
  Record<BusinessProfileVerb, string>
> = {
  leadflow: {
    view: 'leadflow.settings.general.view.admin',
    update: 'leadflow.settings.general.update.admin',
  },
  social: {
    view: 'social.settings.general.view.admin',
    update: 'social.settings.general.update.admin',
  },
};

/**
 * The single permission key that authorizes `verb` for the caller's
 * resolved `productKey`. Agency-mode `productKey: 'agency'` requests (the
 * platform shell itself, not LeadFlow or Social) have no product-specific
 * permission to bind to — this surface only makes sense once a real product
 * is asking, so `'agency'` is rejected here rather than silently allowed
 * through an unrelated permission.
 */
export function resolveBusinessProfilePermissionKey(
  productKey: ProductKey | undefined,
  verb: BusinessProfileVerb,
): string {
  if (productKey === 'leadflow' || productKey === 'social') {
    return PERMISSION_KEY_BY_PRODUCT[productKey][verb];
  }

  throw new ForbiddenException(
    'A product context (x-lyra-product-key: leadflow or social) is required to access the business profile.',
  );
}
