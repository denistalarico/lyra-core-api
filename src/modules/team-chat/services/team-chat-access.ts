/**
 * Team Chat authorization primitive (CCOM0.5).
 *
 * Before this file the module had two different answers to "can this user see
 * this channel?": `applyCollectionScope`/`applySearchScope` filtered by active
 * membership when listing, while `assertChannel()` checked only
 * `id + tenant_id + workspace_id` on every direct-object path. The result was
 * that a channel invisible in the sidebar was fully readable — and writable —
 * by anyone who knew its UUID.
 *
 * The rule lives here once so collection visibility and direct object
 * visibility cannot drift apart again. The SQL in `applyCollectionScope` and
 * the predicate in `evaluateChannelAccess` are deliberately the same rule
 * expressed in two places (set-at-a-time vs row-at-a-time); the specs assert
 * they agree.
 */

import { TeamChatChannelVisibility } from '../enums';

export type TeamChatContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string | null;
  role?: string | null;
};

/** The subset of `AgencyChatChannel` the access rule reads. */
export type ChannelAccessSubject = {
  id: string;
  tenantId: string;
  workspaceId: string;
  visibility: TeamChatChannelVisibility;
};

/** The subset of `AgencyChatChannelMember` the access rule reads. */
export type MembershipAccessSubject = {
  userId: string | null;
  leftAt: Date | null;
};

export type ChannelAccessDenialReason =
  | 'unauthenticated'
  | 'tenant_mismatch'
  | 'workspace_mismatch'
  | 'not_a_participant';

export type ChannelAccessDecision =
  | {
      allowed: true;
      via: 'elevated_role' | 'workspace_visibility' | 'participant';
    }
  | { allowed: false; reason: ChannelAccessDenialReason };

export function normalizeRole(role?: string | null): string {
  if (role === 'owner') return 'owner';
  if (role === 'admin' || role === 'administrator') return 'admin';
  if (role === 'manager') return 'manager';
  return 'member';
}

/**
 * Owner/admin see every channel in their workspace.
 *
 * This is the pre-existing `applyCollectionScope` behaviour, kept verbatim and
 * deliberately not widened: `manager` is NOT elevated here, exactly as it was
 * not elevated for channel lists before. CCOM0.5 closes holes; it does not
 * hand anyone new reach.
 */
export function isElevatedRole(role?: string | null): boolean {
  return ['owner', 'admin'].includes(normalizeRole(role));
}

/**
 * Decides whether `context` may act on `channel`.
 *
 * `membership` is the caller's own row for that channel, or null when none
 * exists. A row with `leftAt` set is not a participant: it is the record of
 * someone who left, and `applyCollectionScope` already excluded it.
 *
 * `visibility='workspace'` means what it says and what the UI already implied:
 * the channel is open to every authenticated user of that workspace, with no
 * membership row required. That is the semantics preserved from before this
 * sprint (CCOM0.5 §8) — no code ever read `visibility`, so every channel was
 * effectively workspace-visible; narrowing `workspace` now would be a product
 * change, not a security fix. `private`, `client_context` and
 * `project_context` all require participation.
 */
export function evaluateChannelAccess(
  context: TeamChatContext,
  channel: ChannelAccessSubject,
  membership: MembershipAccessSubject | null,
): ChannelAccessDecision {
  if (channel.tenantId !== context.tenantId) {
    return { allowed: false, reason: 'tenant_mismatch' };
  }

  if (channel.workspaceId !== context.workspaceId) {
    return { allowed: false, reason: 'workspace_mismatch' };
  }

  if (isElevatedRole(context.role)) {
    return { allowed: true, via: 'elevated_role' };
  }

  if (!context.userId) {
    return { allowed: false, reason: 'unauthenticated' };
  }

  if (channel.visibility === TeamChatChannelVisibility.WORKSPACE) {
    return { allowed: true, via: 'workspace_visibility' };
  }

  if (membership && membership.leftAt === null) {
    return { allowed: true, via: 'participant' };
  }

  return { allowed: false, reason: 'not_a_participant' };
}
