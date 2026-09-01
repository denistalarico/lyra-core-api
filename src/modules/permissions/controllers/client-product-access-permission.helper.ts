// src/modules/permissions/controllers/client-product-access-permission.helper.ts
//
// Product-bound permission resolution for
// `GET /permissions/clients/:clientId/products/:productKey/access`.
//
// Mirrors the pattern `resolveBusinessProfilePermissionKey` established in
// `platform-settings-permission.helper.ts` for S1.4.0: `canAccessClientProduct`
// proves the caller may operate a specific client's product — it says
// nothing about who may *administer visibility of access* for that product.
// A LeadFlow admin permission must never authorize a Social access query,
// and vice versa (S1.4.7 pointed correction). This helper resolves exactly
// one permission key from the requested `productKey`, so the runtime
// decision in the controller always checks the one key that actually
// corresponds to the product being asked about — never an OR of both.
//
// This lives inside the `permissions` module (not `platform-settings`) so
// `permissions` never depends on `platform-settings`.

import { ForbiddenException } from '@nestjs/common';
import { ClientProductKey } from '../enums/permission.enums';

const PERMISSION_KEY_BY_PRODUCT: Record<ClientProductKey, string> = {
  [ClientProductKey.LeadFlow]: 'leadflow.settings.permissions.manage.admin',
  [ClientProductKey.Social]: 'social.settings.permissions.manage.admin',
};

/**
 * The single permission key that authorizes viewing
 * `agency_client_product_access` grants for the given `productKey`. Throws
 * for anything outside the known product keys rather than falling back to
 * either key — there is no "neutral" administrative permission here.
 */
export function resolveClientProductAccessPermissionKey(
  productKey: string,
): string {
  if (
    Object.values(ClientProductKey).includes(productKey as ClientProductKey)
  ) {
    return PERMISSION_KEY_BY_PRODUCT[productKey as ClientProductKey];
  }

  throw new ForbiddenException(
    `productKey must be one of: ${Object.values(ClientProductKey).join(', ')}.`,
  );
}
