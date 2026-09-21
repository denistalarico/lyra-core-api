// src/common/context/managed-context.contract.ts
//
// Canonical contract for "which company am I operating, and which companies
// may I operate?" (LF-RF-F12-001).
//
// One person can be linked to several managed companies of the same agency
// (Portal blueprint section 7). The shell — today the LeadFlow provider,
// tomorrow the Portal — needs a single server-side answer for:
//
//   1. the set of contexts the caller is authorized to operate per product;
//   2. the context that is actually active for the current request;
//   3. why a requested context was refused, when it was.
//
// Every field here is derived server-side. Nothing in this contract may be
// trusted from the browser: the client only *requests* a context through
// headers, and the server answers with what it accepted.

import type { OperatingMode, ProductKey } from './request-context.interface';
import type { AgencyClientCompanyContextStatus } from '../../modules/clients/entities/agency-client-company-context.entity';

/** Products that can be operated on behalf of a managed company. */
export const MANAGED_CLIENT_PRODUCT_KEYS = ['leadflow', 'social'] as const;

export type ManagedClientProductKey =
  (typeof MANAGED_CLIENT_PRODUCT_KEYS)[number];

export function isManagedClientProductKey(
  value: string | null | undefined,
): value is ManagedClientProductKey {
  return (
    typeof value === 'string' &&
    (MANAGED_CLIENT_PRODUCT_KEYS as readonly string[]).includes(value)
  );
}

/** Identity used to resolve authorization. Mirrors `PermissionContext`. */
export interface ManagedContextIdentity {
  tenantId: string;
  workspaceId?: string | null;
  userId: string;
  role: string;
}

/**
 * A managed client the caller is authorized to operate a given product in:
 * active client, active product entitlement on the managed tenant and
 * (unless the caller is owner/admin) an explicit client + client-product
 * access grant for the caller.
 */
export interface AuthorizedManagedClient {
  clientId: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
  managedTenantId: string;
  /** Operational companies are nested under their Agency Client. */
  companies: AuthorizedManagedCompany[];
  entitlement: {
    status: string;
    planKey: string | null;
    source: string;
    startsAt: string | null;
    endsAt: string | null;
    trialEndsAt: string | null;
  };
}

export interface AuthorizedManagedCompany {
  companyContextId: string;
  companyContactId: string;
  displayName: string;
  legalName: string | null;
  isPrimary: boolean;
  status?: AgencyClientCompanyContextStatus;
}

/** Contexts available for one product. */
export interface ManagedContextAvailability {
  /** Whether the agency tenant itself may operate the product. */
  agency: boolean;
  /** Managed companies the caller may operate the product for. */
  clients: AuthorizedManagedClient[];
}

export type ActiveManagedContext =
  | {
      kind: 'agency';
      productKey: ProductKey;
      clientId: null;
      companyContextId: null;
      managedTenantId: null;
      displayName: null;
    }
  | {
      kind: 'client';
      productKey: ManagedClientProductKey;
      clientId: string;
      /** Null means the explicitly supported legacy/unscoped client context. */
      companyContextId: string | null;
      managedTenantId: string;
      displayName: string;
    };

export type ManagedContextRejectionCode =
  /** Client mode was requested without a client id header. */
  | 'client_id_missing'
  /** Company was requested without its owning Agency Client. */
  | 'company_context_client_id_missing'
  /** Missing, cross-client, cross-tenant, or cross-workspace company context. */
  | 'company_context_not_available'
  /** Company context belongs to this client but is not active. */
  | 'company_context_inactive'
  /** Company context belongs to this client but has been archived. */
  | 'company_context_archived'
  /** Client mode was requested for a product that has no managed scope. */
  | 'product_not_client_scoped'
  /** The session has no workspace, so no client context can be resolved. */
  | 'workspace_missing'
  /**
   * The requested company exists but the caller may not operate this product
   * for it: archived client, missing/expired entitlement on the managed
   * tenant, or no explicit client/product grant.
   */
  | 'context_not_authorized';

export interface ManagedContextRejection {
  code: ManagedContextRejectionCode;
  requestedClientId: string | null;
  requestedCompanyContextId?: string | null;
  requestedProductKey: string | null;
}

/**
 * Context the caller asked for, read from request headers. Never trusted:
 * it is only an input to {@link ManagedContextDirectoryService.resolveActiveContext}.
 */
export interface RequestedManagedContext {
  productKey: ProductKey | null;
  operatingMode: OperatingMode | null;
  clientId: string | null;
  companyContextId: string | null;
}

export interface ActiveManagedContextResolution {
  active: ActiveManagedContext;
  requested: RequestedManagedContext;
  rejection: ManagedContextRejection | null;
}

const PRODUCT_KEY_HEADERS = ['x-lyra-product-key'];
const OPERATING_MODE_HEADERS = [
  'x-lyra-operating-mode',
  'x-leadflow-operating-mode',
];
const CLIENT_ID_HEADERS = ['x-lyra-client-id', 'x-client-id'];
const COMPANY_CONTEXT_ID_HEADERS = ['x-lyra-company-context-id'];

const PRODUCT_KEYS = new Set<string>(['agency', 'leadflow', 'social']);
const OPERATING_MODES = new Set<string>(['agency', 'client']);

export type ManagedContextHeaders = Record<
  string,
  string | string[] | undefined
>;

function readHeader(
  headers: ManagedContextHeaders,
  names: string[],
): string | null {
  for (const name of names) {
    const rawValue = headers[name];
    const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    const normalized = value?.trim();

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

/**
 * Reads the requested context from headers without throwing.
 *
 * `OperationalContextResolver` rejects malformed headers with a 400 because
 * an operational request cannot proceed without a valid context. The shell
 * contract must not: a stale selection saved in the browser has to produce a
 * usable context payload (agency, plus a rejection reason) instead of an
 * error page, so the client can correct itself.
 */
export function readRequestedManagedContext(
  headers: ManagedContextHeaders,
): RequestedManagedContext {
  const rawProductKey = readHeader(headers, PRODUCT_KEY_HEADERS);
  const rawOperatingMode = readHeader(headers, OPERATING_MODE_HEADERS);
  const rawClientId = readHeader(headers, CLIENT_ID_HEADERS);
  const companyContextId = readHeader(headers, COMPANY_CONTEXT_ID_HEADERS);

  const productKey =
    rawProductKey && PRODUCT_KEYS.has(rawProductKey)
      ? (rawProductKey as ProductKey)
      : rawProductKey === null && rawOperatingMode !== null
        ? // Legacy LeadFlow clients only send `x-leadflow-operating-mode`.
          ('leadflow' as ProductKey)
        : null;

  const operatingMode =
    rawOperatingMode && OPERATING_MODES.has(rawOperatingMode)
      ? (rawOperatingMode as OperatingMode)
      : null;

  return {
    productKey,
    operatingMode,
    clientId: rawClientId,
    companyContextId,
  };
}

export function buildAgencyActiveContext(
  productKey: ProductKey,
): ActiveManagedContext {
  return {
    kind: 'agency',
    productKey,
    clientId: null,
    companyContextId: null,
    managedTenantId: null,
    displayName: null,
  };
}
