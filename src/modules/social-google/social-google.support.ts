import type { SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import {
  GOOGLE_PRODUCT_SCOPES,
  GOOGLE_PRODUCTS,
  type GoogleProduct,
} from './google-oauth.constants';
import type {
  SocialGoogleAuthorizationEntity,
  SocialGoogleProductLinkEntity,
} from './entities';

/** Restricts a query to exactly one tenant/workspace/company context. */
export function whereScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  scope: CompanyAwareScope,
): SelectQueryBuilder<T> {
  return qb
    .andWhere(`${alias}.tenantId = :tenantId`, { tenantId: scope.tenantId })
    .andWhere(`${alias}.workspaceId = :workspaceId`, {
      workspaceId: scope.workspaceId,
    })
    .andWhere(`${alias}.agencyClientId IS NOT DISTINCT FROM :agencyClientId`, {
      agencyClientId: scope.agencyClientId,
    })
    .andWhere(
      `${alias}.companyContextId IS NOT DISTINCT FROM :companyContextId`,
      { companyContextId: scope.companyContextId },
    );
}

/** Safe, credential-free projection of an authorization and its products. */
export function toGoogleStatusView(
  authorization: SocialGoogleAuthorizationEntity | null,
  links: SocialGoogleProductLinkEntity[],
  sharedIdentity = false,
) {
  const live =
    authorization && authorization.status !== 'revoked' ? authorization : null;
  const granted = new Set(live?.grantedScopes ?? []);
  const reauthRequired = live?.status === 'reauth_required';

  const products = GOOGLE_PRODUCTS.map((product) => {
    const link = links.find((candidate) => candidate.product === product);
    const connected = !!live && link?.status === 'connected';
    return {
      product,
      requiredScope: GOOGLE_PRODUCT_SCOPES[product],
      status: connected ? ('connected' as const) : ('disconnected' as const),
      scopeGranted: connected && granted.has(GOOGLE_PRODUCT_SCOPES[product]),
      reauthRequired: connected && reauthRequired,
      connectedAt: connected
        ? (link?.connectedAt?.toISOString() ?? null)
        : null,
    };
  });

  return {
    status: live ? live.status : ('not_connected' as const),
    reauthRequired,
    connectedAt: live?.connectedAt.toISOString() ?? null,
    grantedScopes: live ? [...live.grantedScopes] : [],
    lastError: live?.lastError ?? null,
    products,
    // What a full revocation would take down; shown before the user confirms.
    revokeImpact: {
      products: products
        .filter((item) => item.status === 'connected')
        .map((item) => item.product),
      // Another live authorization holds a grant for this Google identity, so
      // revoking at Google could break it; the remote revoke is then refused.
      sharedIdentity,
      remoteRevocationAvailable: !sharedIdentity,
    },
  };
}

export type GoogleProductName = GoogleProduct;
