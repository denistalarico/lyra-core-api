// src/modules/brand-kit/brand-kit-permission.helper.ts
//
// Product-bound permission resolution for the neutral Brand Kit routes
// (Lyra Social S1.4.9 §12).
//
// Same pattern as `resolveBusinessProfilePermissionKey` (S1.4.0),
// `resolveClientProductAccessPermissionKey` (S1.4.7) and
// `resolveTelemetryPermissionKey` (S1.4.8): the endpoint is neutral of
// product, the authorization is not. Exactly one key is resolved from the
// request's own `productKey` and asserted — never an OR across products.
//
// WHY ONLY SOCIAL TODAY
// ---------------------
// The permission catalog carries `social.brandkit.*` and nothing equivalent
// for LeadFlow. Rather than invent `leadflow.brandkit.*` keys that no role
// matrix grants and no screen uses — which would look like authorization
// while granting nothing — a LeadFlow-context call is refused here. The
// surface stays reusable: when LeadFlow genuinely owns Brand Kit, its keys
// enter the catalog and one entry is added to this map. Refusing is the
// honest state until then, and it fails closed.

import { ForbiddenException } from '@nestjs/common';
import type { ProductKey } from '../../common/context/request-context.interface';

export type BrandKitVerb = 'view' | 'update' | 'delete';

/**
 * The catalog keys, used verbatim. `delete` is deliberately the
 * owner-only/dangerous key: removing a client's logo destroys a binary that
 * nothing else in the platform can restore.
 */
const SOCIAL_BRAND_KIT_PERMISSIONS: Record<BrandKitVerb, string> = {
  view: 'social.brandkit.asset.view.client',
  update: 'social.brandkit.assets.manage.manager_or_admin',
  delete: 'social.brandkit.asset.delete.owner_or_admin_explicit',
};

const PERMISSION_KEY_BY_PRODUCT: Partial<
  Record<ProductKey, Record<BrandKitVerb, string>>
> = {
  social: SOCIAL_BRAND_KIT_PERMISSIONS,
};

/** Every Brand Kit key, for the guard-level decorator that makes the guard run. */
export const BRAND_KIT_ANY_PERMISSIONS = Object.values(
  SOCIAL_BRAND_KIT_PERMISSIONS,
);

/**
 * The single permission key that authorizes `verb` for the caller's resolved
 * `productKey`. `'agency'` (the platform shell, no product asking) and
 * `'leadflow'` (no Brand Kit keys in the catalog) are refused rather than
 * silently allowed through an unrelated key.
 */
export function resolveBrandKitPermissionKey(
  productKey: ProductKey | undefined,
  verb: BrandKitVerb,
): string {
  const permissions = productKey
    ? PERMISSION_KEY_BY_PRODUCT[productKey]
    : undefined;

  if (!permissions) {
    throw new ForbiddenException(
      'A product context that owns Brand Kit (x-lyra-product-key: social) is required.',
    );
  }

  return permissions[verb];
}
