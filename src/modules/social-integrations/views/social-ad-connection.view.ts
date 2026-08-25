// src/modules/social-integrations/views/social-ad-connection.view.ts
//
// The only shape a connection may take on its way out of the API.
//
// Built by *construction*, never by deletion — the same rule as
// `portal-public.view.ts`. Nothing is spread from the entity, so a column
// added tomorrow (a second token, an internal flag, a provider payload)
// cannot reach a client by accident. Exposing a new field requires editing
// this builder, which is the review moment a credential store needs.

import type {
  SocialAdAccountConnectionEntity,
  SocialAdConnectionStatus,
  SocialAdProvider,
} from '../entities/social-ad-account-connection.entity';

/** Days before expiry at which the UI should start warning. */
export const TOKEN_EXPIRY_WARNING_DAYS = 7;

/**
 * What the settings screen renders. `connected` and `expiring` are distinct
 * because "working" and "working, but not for much longer" call for different
 * actions from the operator.
 */
export type SocialAdConnectionState =
  | 'not_connected'
  | 'connecting'
  | 'awaiting_selection'
  | 'connected'
  | 'expiring'
  | 'error'
  | 'disconnected';

export interface SocialAdAccountOptionView {
  externalAccountId: string;
  accountName: string | null;
  currency: string | null;
  timezone: string | null;
  businessName: string | null;
  /** Provider-side account status, when the provider reports one. */
  accountStatus: string | null;
}

export interface SocialAdConnectionView {
  id: string;
  provider: SocialAdProvider;
  state: SocialAdConnectionState;
  status: SocialAdConnectionStatus;
  agencyClientId: string | null;
  /** Masked. The full account id is an addressable provider resource. */
  maskedAccountId: string | null;
  accountName: string | null;
  currency: string | null;
  timezone: string | null;
  businessName: string | null;
  scopes: string[];
  /** Whether a credential exists — never the credential itself. */
  hasCredential: boolean;
  tokenExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Accounts the authorizing user may choose from. Present only while the
   * connection is `awaiting_selection`; the ids are unmasked here because the
   * operator just authorized these accounts and has to pass one back to
   * `/select`.
   */
  availableAccounts?: SocialAdAccountOptionView[];
}

/**
 * Shows enough of the account id to recognize it, never enough to address it.
 * Meta ad account ids arrive as `act_1234567890`; the prefix is kept because
 * it is what the operator sees in the provider's own UI.
 */
export function maskExternalAccountId(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const separatorIndex = value.indexOf('_');
  const prefix = separatorIndex > 0 ? value.slice(0, separatorIndex + 1) : '';
  const digits = separatorIndex > 0 ? value.slice(separatorIndex + 1) : value;

  if (digits.length <= 4) {
    return `${prefix}${digits}`;
  }

  return `${prefix}${'•'.repeat(Math.min(digits.length - 4, 8))}${digits.slice(-4)}`;
}

function isExpiringSoon(tokenExpiresAt: Date | null, now: Date) {
  if (!tokenExpiresAt) {
    return false;
  }

  const remainingMs = tokenExpiresAt.getTime() - now.getTime();

  return remainingMs <= TOKEN_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
}

export function resolveConnectionState(
  connection: Pick<
    SocialAdAccountConnectionEntity,
    'connectionStatus' | 'tokenExpiresAt' | 'credentialRemovedAt'
  >,
  now: Date = new Date(),
): SocialAdConnectionState {
  if (connection.credentialRemovedAt) {
    return 'disconnected';
  }

  switch (connection.connectionStatus) {
    case 'pending':
      return 'connecting';
    case 'awaiting_selection':
      return 'awaiting_selection';
    case 'error':
      return 'error';
    case 'disconnected':
      return 'disconnected';
    case 'connected':
      return isExpiringSoon(connection.tokenExpiresAt, now)
        ? 'expiring'
        : 'connected';
    default:
      return 'not_connected';
  }
}

function readMetadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];

  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The connection payload the API may return.
 *
 * Deliberately absent, and not by omission: `accessTokenEncrypted`,
 * `refreshTokenEncrypted`, `credentialVersion`, `oauthStateHash`,
 * `oauthExpiresAt`, `createdById`, `metadata`, and the unmasked
 * `externalAccountId`. Those are either credentials, credential machinery, or
 * provider handles that enable enumeration.
 */
export function toSocialAdConnectionView(
  connection: SocialAdAccountConnectionEntity,
  now: Date = new Date(),
): SocialAdConnectionView {
  const state = resolveConnectionState(connection, now);

  return {
    id: connection.id,
    provider: connection.provider,
    state,
    status: connection.connectionStatus,
    agencyClientId: connection.agencyClientId,
    maskedAccountId: maskExternalAccountId(connection.externalAccountId),
    accountName: connection.accountName,
    currency: connection.currency,
    timezone: connection.timezone,
    businessName: readMetadataString(connection.metadata, 'businessName'),
    scopes: Array.isArray(connection.scopes) ? [...connection.scopes] : [],
    hasCredential:
      connection.connectionStatus === 'connected' &&
      !connection.credentialRemovedAt,
    tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    lastSyncError: connection.lastSyncError,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
    ...(state === 'awaiting_selection'
      ? { availableAccounts: readAccountOptions(connection.metadata) }
      : {}),
  };
}

/**
 * Rebuilds the selectable accounts from metadata field by field. Metadata is
 * provider-shaped and untrusted for output purposes; spreading it would put
 * whatever Meta returned into a response.
 */
export function readAccountOptions(
  metadata: Record<string, unknown> | null | undefined,
): SocialAdAccountOptionView[] {
  const raw = metadata?.selectableAccounts;

  if (!Array.isArray(raw)) {
    return [];
  }

  const options: SocialAdAccountOptionView[] = [];

  for (const candidate of raw) {
    if (typeof candidate !== 'object' || candidate === null) continue;

    const entry = candidate as Record<string, unknown>;
    const externalAccountId =
      typeof entry.externalAccountId === 'string'
        ? entry.externalAccountId.trim()
        : '';

    if (!externalAccountId) continue;

    options.push({
      externalAccountId,
      accountName: readMetadataString(entry, 'accountName'),
      currency: readMetadataString(entry, 'currency'),
      timezone: readMetadataString(entry, 'timezone'),
      businessName: readMetadataString(entry, 'businessName'),
      accountStatus: readMetadataString(entry, 'accountStatus'),
    });
  }

  return options;
}

/**
 * Field names that must never appear in a Social Integrations payload. The
 * builder above is the real defense; this list is the independent net the
 * contract tests use to catch a future builder that forgets.
 *
 * `externalAccountId` is intentionally *not* listed: the selection step has to
 * hand back the ids the user just authorized. The connection payload still
 * masks it (`maskedAccountId`), which is asserted separately.
 */
export const SOCIAL_INTEGRATIONS_FORBIDDEN_FIELD_NAMES = [
  'accessToken',
  'access_token',
  'accessTokenEncrypted',
  'access_token_encrypted',
  'refreshToken',
  'refresh_token',
  'refreshTokenEncrypted',
  'refresh_token_encrypted',
  'credentialVersion',
  'credential_version',
  'oauthStateHash',
  'oauth_state_hash',
  'oauthState',
  'code',
  'appSecret',
  'client_secret',
  'clientSecret',
  'tenantId',
  'tenant_id',
  'workspaceId',
  'workspace_id',
  'metadata',
] as const;

/** Collects forbidden keys found anywhere in a payload, at any depth. */
export function findForbiddenSocialIntegrationFields(
  payload: unknown,
): string[] {
  const forbidden = new Set<string>(SOCIAL_INTEGRATIONS_FORBIDDEN_FIELD_NAMES);
  const found = new Set<string>();

  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (typeof value !== 'object' || value === null) {
      return;
    }

    for (const [key, nested] of Object.entries(value)) {
      if (forbidden.has(key)) {
        found.add(key);
      }

      walk(nested);
    }
  };

  walk(payload);

  return [...found].sort();
}
