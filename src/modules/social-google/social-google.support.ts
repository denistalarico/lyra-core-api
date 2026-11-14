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

export type GoogleSelectedResource = { id: string; name: string };

/** Products whose data needs an explicit account/property choice (G1). */
const SELECTABLE_PRODUCTS: readonly GoogleProduct[] = ['ga4', 'ads'];

/** GA4 properties kept in `resources`, defensively parsed from jsonb. */
export function readGa4Resources(resources: unknown): Array<{
  propertyId: string;
  displayName: string;
  accountId: string;
  timeZone: string | null;
  currency: string | null;
}> {
  if (!Array.isArray(resources)) return [];
  const out: ReturnType<typeof readGa4Resources> = [];
  for (const item of resources) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.propertyId !== 'string' || !r.propertyId) continue;
    out.push({
      propertyId: r.propertyId,
      displayName:
        typeof r.displayName === 'string' ? r.displayName : r.propertyId,
      accountId: typeof r.accountId === 'string' ? r.accountId : '',
      timeZone: typeof r.timeZone === 'string' ? r.timeZone : null,
      currency: typeof r.currency === 'string' ? r.currency : null,
    });
  }
  return out;
}

/** Safe, credential-free projection of an authorization and its products. */
export function toGoogleStatusView(
  authorization: SocialGoogleAuthorizationEntity | null,
  links: SocialGoogleProductLinkEntity[],
  sharedIdentity = false,
  adsAccounts: GoogleSelectedResource[] = [],
) {
  const live =
    authorization && authorization.status !== 'revoked' ? authorization : null;
  const granted = new Set(live?.grantedScopes ?? []);
  const reauthRequired = live?.status === 'reauth_required';

  const products = GOOGLE_PRODUCTS.map((product) => {
    const link = links.find((candidate) => candidate.product === product);
    const connected = !!live && link?.status === 'connected';
    const selected: GoogleSelectedResource[] = !connected
      ? []
      : product === 'ads'
        ? adsAccounts
        : product === 'ga4'
          ? readGa4Resources(link?.resources).map((property) => ({
              id: property.propertyId,
              name: property.displayName,
            }))
          : [];
    return {
      product,
      requiredScope: GOOGLE_PRODUCT_SCOPES[product],
      status: connected ? ('connected' as const) : ('disconnected' as const),
      scopeGranted: connected && granted.has(GOOGLE_PRODUCT_SCOPES[product]),
      reauthRequired: connected && reauthRequired,
      connectedAt: connected
        ? (link?.connectedAt?.toISOString() ?? null)
        : null,
      // Connected but empty ⇒ "awaiting selection": nothing is read until the
      // user picks an account/property.
      selection: {
        required: connected && SELECTABLE_PRODUCTS.includes(product),
        selected,
      },
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
