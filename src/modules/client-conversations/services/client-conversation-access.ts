/**
 * CCOM1 — the Client Conversation access primitive.
 *
 * One rule, stated once, evaluated identically by the Client REST boundary, the
 * Agency REST boundary, both realtime gateways and the attachment stream. The
 * Agency chat learned this the hard way: it had two different answers to "may
 * this user see this channel?" — a membership-filtered SQL for lists and a
 * tenant-only check for direct objects — and the gap meant any channel was
 * readable by UUID (CCOM0.5 §1). Keeping the predicate in one pure function is
 * what stops that divergence from being possible here.
 *
 * WHAT THIS FUNCTION DELIBERATELY DOES NOT DO
 * -------------------------------------------
 * It never loads anything. The caller arrives having already proven the
 * *authorization* of its own surface — a `ClientAreaContext` from the Client
 * Area guard chain, or an Agency `RequestContext` plus client access from
 * `PermissionsGuard` — and this function only checks that the conversation row
 * in hand actually belongs to that proven scope. Authorization is never
 * re-derived from the conversation; the conversation is checked against the
 * authorization. That ordering is what makes "knowing a conversation UUID"
 * worthless (CCOM1 §51).
 */

import type { ClientConversationSurface } from '../client-conversation.types';

/** The scope a caller has already had proven for it, by its own surface. */
export type ClientConversationScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string;
  companyContextId: string;
};

/**
 * Narrows a `CompanyAwareScope` to this domain's scope.
 *
 * `CompanyAwareScope` allows `(agencyClientId, companyContextId)` to be null —
 * that shape represents agency-wide and `legacy_unassigned` rows. No
 * conversation can exist in either, so the nullable shape is rejected here
 * rather than cast away: `as never` at the call sites would have let a null
 * company reach a query, where it would match nothing silently instead of
 * failing loudly.
 */
export function toConversationScope(scope: {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId: string | null;
}): ClientConversationScope {
  if (!scope.agencyClientId || !scope.companyContextId) {
    throw new Error(
      'Client Conversation scope requires an Agency Client and a Company Context.',
    );
  }

  return {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    agencyClientId: scope.agencyClientId,
    companyContextId: scope.companyContextId,
  };
}

/** The subset of the conversation row the rule reads. */
export type ConversationAccessSubject = {
  id: string;
  tenantId: string;
  workspaceId: string;
  agencyClientId: string;
  companyContextId: string;
  status: string;
};

export type ConversationAccessDenialReason =
  | 'tenant_mismatch'
  | 'workspace_mismatch'
  | 'client_mismatch'
  | 'company_mismatch'
  | 'archived';

export type ConversationAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: ConversationAccessDenialReason };

/**
 * Decides whether a conversation row is inside the caller's proven scope.
 *
 * All four scope ids are compared, not just tenant and workspace. The Agency
 * chat compared only the first two, which is exactly why a channel id was
 * enough to read someone else's conversation; here a conversation of company B
 * fails for a caller proven for company A even inside one workspace.
 *
 * `requireActive` is false for read paths so an archived conversation stays
 * readable as history, and true for writes.
 */
export function evaluateConversationAccess(
  scope: ClientConversationScope,
  conversation: ConversationAccessSubject,
  options: { requireActive?: boolean } = {},
): ConversationAccessDecision {
  if (conversation.tenantId !== scope.tenantId) {
    return { allowed: false, reason: 'tenant_mismatch' };
  }

  if (conversation.workspaceId !== scope.workspaceId) {
    return { allowed: false, reason: 'workspace_mismatch' };
  }

  if (conversation.agencyClientId !== scope.agencyClientId) {
    return { allowed: false, reason: 'client_mismatch' };
  }

  if (conversation.companyContextId !== scope.companyContextId) {
    return { allowed: false, reason: 'company_mismatch' };
  }

  if (options.requireActive && conversation.status !== 'active') {
    return { allowed: false, reason: 'archived' };
  }

  return { allowed: true };
}

/**
 * The realtime room of a conversation.
 *
 * Built only from ids the server has validated, and namespaced per surface so
 * an Agency socket and a client socket are never in the same room even for the
 * same conversation — the two feeds are separate by construction, not by a
 * filter someone could forget (CCOM1 §32/§34).
 *
 * Nothing in a socket payload ever reaches this function; callers pass the
 * context their handshake produced. That inversion is the whole lesson of
 * CCOM0.5 §3, where the room came from the payload and any three guessed UUIDs
 * bought a seat.
 */
export function conversationRoom(
  surface: ClientConversationSurface,
  scope: Pick<ClientConversationScope, 'tenantId' | 'companyContextId'>,
  conversationId: string,
): string {
  const prefix = surface === 'client_area' ? 'client' : 'agency';
  return `${prefix}:${scope.tenantId}:${scope.companyContextId}:conversation:${conversationId}`;
}

/**
 * Unread count watermark (CCOM1 §45). `last_read_at ?? joined_at`, never
 * "everything when null" — the Agency chat's counter returned the whole channel
 * history for anyone who had not opened it yet (CCOM0.5 §7), and a legacy row
 * with neither timestamp counts zero here, because under-counting a badge is
 * the safe direction.
 */
export function unreadWatermark(participant: {
  lastReadAt: Date | null;
  joinedAt: Date | null;
}): Date | null {
  return participant.lastReadAt ?? participant.joinedAt ?? null;
}
