import { createHash } from 'node:crypto';
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

/**
 * Stable, non-reversible label for a Google identity within one tenant, so the
 * UI can tell whether two products use the same account without ever seeing
 * the subject.
 */
export function identityRef(tenantId: string, googleSub: string) {
  return createHash('sha256')
    .update(`${tenantId}:${googleSub}`)
    .digest('hex')
    .slice(0, 8);
}

/**
 * Safe, credential-free projection of a context's Google authorizations (one
 * per Google identity) and the products each one backs. Every product reports
 * the state of its own authorization only.
 */
export function toGoogleStatusView(
  authorizations: SocialGoogleAuthorizationEntity[],
  links: SocialGoogleProductLinkEntity[],
  sharedIdentityIds: ReadonlySet<string> = new Set(),
  adsAccounts: GoogleSelectedResource[] = [],
) {
  const live = authorizations.filter((auth) => auth.status !== 'revoked');
  const reauthRequired = live.some((auth) => auth.status === 'reauth_required');

  const products = GOOGLE_PRODUCTS.map((product) => {
    const link = links.find(
      (candidate) =>
        candidate.product === product &&
        candidate.status === 'connected' &&
        live.some((auth) => auth.id === candidate.authorizationId),
    );
    const auth = link
      ? live.find((candidate) => candidate.id === link.authorizationId)
      : undefined;
    const connected = !!link && !!auth;
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
      authorizationId: connected ? auth.id : null,
      identityRef: connected
        ? identityRef(auth.tenantId, auth.googleSub)
        : null,
      scopeGranted:
        connected &&
        auth.grantedScopes.includes(GOOGLE_PRODUCT_SCOPES[product]),
      reauthRequired: connected && auth.status === 'reauth_required',
      connectedAt: connected ? (link.connectedAt?.toISOString() ?? null) : null,
      // Connected but empty ⇒ "awaiting selection": nothing is read until the
      // user picks an account/property.
      selection: {
        required: connected && SELECTABLE_PRODUCTS.includes(product),
        selected,
      },
    };
  });

  const identities = live.map((auth) => ({
    id: auth.id,
    identityRef: identityRef(auth.tenantId, auth.googleSub),
    status: auth.status,
    reauthRequired: auth.status === 'reauth_required',
    connectedAt: auth.connectedAt.toISOString(),
    lastError: auth.lastError,
    // Another live authorization holds a grant for this Google identity, so
    // revoking at Google could break it; the remote revoke is then refused.
    sharedIdentity: sharedIdentityIds.has(auth.id),
    products: products
      .filter((item) => item.authorizationId === auth.id)
      .map((item) => item.product),
  }));

  return {
    status: live.length
      ? reauthRequired
        ? ('reauth_required' as const)
        : ('connected' as const)
      : ('not_connected' as const),
    reauthRequired,
    connectedAt: live[0]?.connectedAt.toISOString() ?? null,
    grantedScopes: Array.from(new Set(live.flatMap((a) => a.grantedScopes))),
    lastError: live.find((auth) => auth.lastError)?.lastError ?? null,
    products,
    authorizations: identities,
    // What a full revocation would take down; shown before the user confirms.
    revokeImpact: {
      products: products
        .filter((item) => item.status === 'connected')
        .map((item) => item.product),
      sharedIdentity: identities.some((item) => item.sharedIdentity),
      remoteRevocationAvailable:
        identities.length === 0 ||
        identities.some((item) => !item.sharedIdentity),
    },
  };
}

export type GoogleProductName = GoogleProduct;
