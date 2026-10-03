import type { Request } from 'express';

/**
 * CA1 — Client Area contracts.
 *
 * Deliberately independent from the Agency `RequestContext`/`ManagedContext`
 * (CA0 §K/L): `operatingMode='client'` means "an Agency operator working on a
 * managed client", never "the client person". Nothing here may flow into
 * `normalizeRole`, `PlatformPermissionService` or `PermissionsGuard`, which is
 * why the role keys are prefixed and live in this module only.
 */

export const CLIENT_AREA_ROLES = [
  'client_admin',
  'client_operator',
  'client_viewer',
] as const;
export type ClientAreaRole = (typeof CLIENT_AREA_ROLES)[number];

export const CLIENT_AREA_MEMBERSHIP_STATUSES = ['active', 'revoked'] as const;
export type ClientAreaMembershipStatus =
  (typeof CLIENT_AREA_MEMBERSHIP_STATUSES)[number];

export const CLIENT_AREA_PERMISSION_KEYS = [
  'client_area.approvals.view',
  'client_area.approvals.comment',
  'client_area.approvals.decide',
  // CCOM1 — conversations. `send` is separate from `view` because a viewer
  // preset must be able to read a thread without being able to speak into it.
  'client_area.conversations.view',
  'client_area.conversations.send',
] as const;
export type ClientAreaPermissionKey =
  (typeof CLIENT_AREA_PERMISSION_KEYS)[number];

export const CLIENT_AREA_MODULE_KEYS = ['approvals', 'conversations'] as const;
export type ClientAreaModuleKey = (typeof CLIENT_AREA_MODULE_KEYS)[number];

export type ClientAreaModules = Record<ClientAreaModuleKey, boolean>;

/**
 * PD3 §16 — a Client Area context is either an external company or the agency
 * itself. An explicit discriminator, so `companyContextId` never carries a
 * fake UUID to stand in for the agency.
 */
export const CLIENT_AREA_CONTEXT_KINDS = ['company', 'agency_self'] as const;
export type ClientAreaContextKind = (typeof CLIENT_AREA_CONTEXT_KINDS)[number];

/** Opaque id of the agency self-context in URLs and the directory. */
export const AGENCY_SELF_CONTEXT_ID = 'agency_self' as const;

/** PD3 §29 — audit actions of self-context activation and access. */
export const CLIENT_AREA_SELF_ACCESS_EVENT_ACTIONS = [
  'self_area_enabled',
  'self_area_disabled',
  'self_access_granted',
  'self_access_revoked',
  'self_access_role_changed',
] as const;
export type ClientAreaSelfAccessEventAction =
  (typeof CLIENT_AREA_SELF_ACCESS_EVENT_ACTIONS)[number];

/** CA2 — invitation lifecycle. Expiry is `expires_at`, never a status. */
export const CLIENT_AREA_INVITATION_STATUSES = [
  'pending',
  'accepted',
  'revoked',
] as const;
export type ClientAreaInvitationStatus =
  (typeof CLIENT_AREA_INVITATION_STATUSES)[number];

/** CA2 — append-only audit trail of invitation/member operations. */
export const CLIENT_AREA_MEMBER_EVENT_ACTIONS = [
  'invited',
  'invitation_resent',
  'invitation_revoked',
  'invitation_accepted',
  'invitation_acceptance_blocked',
  'role_changed',
  'membership_revoked',
] as const;
export type ClientAreaMemberEventAction =
  (typeof CLIENT_AREA_MEMBER_EVENT_ACTIONS)[number];

/** Marker that distinguishes a Client Area access token from any other. */
export const CLIENT_AREA_TOKEN_TYPE = 'client_area' as const;
/** Marker of the short-lived 2FA challenge token of the Client Area login. */
export const CLIENT_AREA_TWO_FACTOR_TOKEN_TYPE = 'client_area_2fa' as const;
/**
 * CA2 — 2FA challenge of an invitation acceptance by an existing identity.
 * Bound to one invitation; useless as a bearer or at the login 2FA step.
 */
export const CLIENT_AREA_INVITATION_TWO_FACTOR_TOKEN_TYPE =
  'client_area_invite_2fa' as const;

/**
 * Access token payload. It proves only *who* and *which session*: role,
 * company and permissions are resolved from the database on every request, so
 * a revoked membership stops working before the token expires.
 */
export interface ClientAreaTokenPayload {
  sub: string;
  tenantId: string;
  sessionId: string;
  typ: typeof CLIENT_AREA_TOKEN_TYPE;
  email?: string;
}

export interface ClientAreaTwoFactorTokenPayload {
  sub: string;
  tenantId: string;
  typ: typeof CLIENT_AREA_TWO_FACTOR_TOKEN_TYPE;
  method: 'email' | 'authenticator';
}

export interface ClientAreaInvitationTwoFactorTokenPayload {
  sub: string;
  tenantId: string;
  invitationId: string;
  typ: typeof CLIENT_AREA_INVITATION_TWO_FACTOR_TOKEN_TYPE;
  method: 'email' | 'authenticator';
}

/** Authenticated person, after the live-session check (no company yet). */
export interface ClientAreaIdentity {
  userId: string;
  tenantId: string;
  sessionId: string;
  email: string;
}

/**
 * Resolved per request for a company-bound route, only after the full
 * authorization formula (CA0 §J) holds. `membershipId` is evidence of the
 * authorization, never an actor — actions are attributed to `userId`.
 */
export interface ClientAreaContext {
  surface: 'client_area';
  userId: string;
  tenantId: string;
  sessionId: string;
  membershipId: string;
  workspaceId: string;
  agencyClientId: string;
  companyContextId: string;
  companyDisplayName: string;
  role: ClientAreaRole;
  permissions: ReadonlySet<ClientAreaPermissionKey>;
  modules: ClientAreaModules;
}

/**
 * PD3 — the agency acting as its own client.
 *
 * Structurally incompatible with `ClientAreaContext` on purpose: there is no
 * `agencyClientId`, no `companyContextId` and no `membershipId`, so a
 * downstream service that needs a company scope cannot be handed a self
 * context by accident — it fails to typecheck. `toCompanyAwareScope` therefore
 * accepts only `ClientAreaContext` (§18, §34).
 */
export interface ClientAreaSelfContext {
  surface: 'client_area';
  kind: typeof AGENCY_SELF_CONTEXT_ID;
  userId: string;
  tenantId: string;
  sessionId: string;
  selfAccessId: string;
  workspaceId: string;
  agencyDisplayName: string;
  role: ClientAreaRole;
  permissions: ReadonlySet<ClientAreaPermissionKey>;
  /**
   * Always all-false in V1. Approvals and Conversations are company-bound
   * artefacts (they need `agencyClientId`/`companyContextId`), so enabling
   * them here would require inventing a company scope. PD3 §15/§34.
   */
  modules: ClientAreaModules;
}

export function isAgencySelfContextId(value: unknown): boolean {
  return value === AGENCY_SELF_CONTEXT_ID;
}

export interface ClientAreaRequest extends Request {
  clientAreaIdentity?: ClientAreaIdentity;
  clientAreaContext?: ClientAreaContext;
  clientAreaSelfContext?: ClientAreaSelfContext;
}

/** Stable, machine-readable error codes of the Client Area surface. */
export const CLIENT_AREA_ERROR_CODES = {
  disabled: 'client_area_disabled',
  invalidCredentials: 'client_area_invalid_credentials',
  accountAmbiguous: 'client_area_account_ambiguous',
  sessionInvalid: 'client_area_session_invalid',
  companyNotFound: 'client_area_company_not_found',
  moduleUnavailable: 'client_area_module_unavailable',
  permissionDenied: 'client_area_permission_denied',
  roleInvalid: 'client_area_role_invalid',
  identityNotFound: 'client_area_identity_not_found',
  identityIsAgencyOperator: 'client_area_identity_is_agency_operator',
  membershipExists: 'client_area_membership_exists',
  membershipNotFound: 'client_area_membership_not_found',
  companyUnavailable: 'client_area_company_unavailable',
  grantorInvalid: 'client_area_grantor_invalid',
  // CA2
  rateLimited: 'client_area_rate_limited',
  invitationInvalid: 'client_area_invitation_invalid',
  invitationNotFound: 'client_area_invitation_not_found',
  contactIneligible: 'client_area_contact_ineligible',
  contactEmailUnavailable: 'client_area_contact_email_unavailable',
  identityContactMissing: 'client_area_identity_contact_missing',
  identityContactConflict: 'client_area_identity_contact_conflict',
  invitationPending: 'client_area_invitation_pending',
  invitationRequiresLogin: 'client_area_invitation_requires_login',
  invitationRequiresSignup: 'client_area_invitation_requires_signup',
  emailInvalid: 'client_area_email_invalid',
  passwordPolicy: 'client_area_password_policy',
  resetTokenInvalid: 'client_area_reset_token_invalid',
  // PD3 — self-context. `selfContextNotFound` mirrors `companyNotFound`: one
  // generic answer for "not enabled", "no access", "revoked", "wrong tenant"
  // and "not an Agency operator", so nothing is enumerable.
  selfContextNotFound: 'client_area_self_context_not_found',
  selfAccessExists: 'client_area_self_access_exists',
  selfAccessNotFound: 'client_area_self_access_not_found',
  selfIdentityNotOperator: 'client_area_self_identity_not_agency_operator',
  selfIdentityIneligible: 'client_area_self_identity_ineligible',
} as const;

export function normalizeClientAreaEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isClientAreaRole(value: unknown): value is ClientAreaRole {
  return (
    typeof value === 'string' &&
    (CLIENT_AREA_ROLES as readonly string[]).includes(value)
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
