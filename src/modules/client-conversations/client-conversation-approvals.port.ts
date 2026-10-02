import { Injectable } from '@nestjs/common';
import type { ClientConversationScope } from './services/client-conversation-access';

/**
 * CCOM2 §11/§16 — the seam the conversations domain reads approvals through.
 *
 * The timeline needs two things from approvals, and neither may be re-derived
 * here:
 *
 *   1. the current client-safe state of a card's approval (§12/§13);
 *   2. the client-visible comments of the approvals of this company (§16).
 *
 * Both already exist, built field by field and covered by
 * `client-approval.contract.spec.ts`: `buildClientApprovalListItem` and the
 * `visibility='client'` query in `ClientApprovalsService`. CCOM2 §11 forbids a
 * second projector, and the reason is not tidiness — a second one would be a
 * second place where a column added to `SocialApprovalRequestEntity` could
 * start reaching customers.
 *
 * So the conversations domain declares what it needs and the implementation
 * lives in the approvals module, filled by the module that imports both.
 *
 * A registry, for the same verified reason as the other direction (see
 * `client-conversation-card.port.ts`): a provider's dependencies resolve in the
 * module that declares the provider, so an injection token bound by the join
 * module would silently be `undefined` here. An unfilled registry means the
 * timeline is exactly the CCOM1 message timeline — correct degradation, not an
 * error.
 */

/** The client-safe status vocabulary (AP3). Mirrored, never re-derived. */
export type ConversationApprovalStatus =
  | 'awaiting_your_review'
  | 'in_revision'
  | 'approved'
  | 'replaced'
  | 'withdrawn';

/**
 * What a card resolves to on read. Everything here is a *current* value from
 * the approvals projection; nothing is read back from `metadata.card` except
 * the `approvalId` that located it.
 */
export type ConversationApprovalCardState = {
  approvalId: string;
  title: string;
  displayType: string;
  versionLabel: string;
  status: ConversationApprovalStatus;
  needsAction: boolean;
  sentToClientAt: string;
  /** AP4 — present only when a client-visible replacement was proven safe. */
  replacementApprovalId?: string;
};

/** One projected approval comment, in the timeline's terms. */
export type ConversationApprovalCommentItem = {
  id: string;
  approvalId: string;
  /** Resolved by the AP3 projection: a client name, or the agency team label. */
  authorName: string;
  authorSide: 'client' | 'agency';
  body: string;
  createdAt: Date;
  /** Label material for "Sobre: {title} ({version})" (§41). */
  approvalTitle: string;
  approvalVersion: string;
  /**
   * Whether the reader wrote it. Decided by the projection, which is the only
   * side holding the raw `actor_user_id` — the timeline never receives it, so
   * an Agency operator's id cannot leak onto the external timeline (§17).
   */
  mine: boolean;
};

export type ClientConversationApprovalsPort = {
  /**
   * Resolves the cards of one page.
   *
   * Scoped, and fail-closed per id: an approval that is not visible to this
   * company — forged, internal-only, never sent, or belonging elsewhere —
   * simply does not appear in the returned map, and the renderer then has a
   * card it cannot resolve (§15). It is never an error, because one unresolvable
   * row must not take down a whole timeline page.
   */
  resolveCards(
    scope: ClientConversationScope,
    approvalIds: readonly string[],
  ): Promise<Map<string, ConversationApprovalCardState>>;

  /**
   * Client-visible comments of this company's approvals, newest-first, bounded.
   *
   * `visibility='client'` only (§16/§49). `stage` is never used as an audience:
   * an agency note written while the request waits on the client is
   * `stage='client'` with `visibility='internal'`, and reading `stage` would
   * publish it (CA0 §AC).
   */
  listClientVisibleComments(
    scope: ClientConversationScope,
    query: {
      before?: Date | null;
      limit: number;
      /** Whose comments are "mine"; null for an Agency reader or the preview. */
      readerUserId?: string | null;
    },
  ): Promise<ConversationApprovalCommentItem[]>;

  /**
   * What the reader may do on an approval right now (§13).
   *
   * Resolved per request from the caller's own live permissions and module
   * availability, never from anything persisted. An Agency reader and the
   * preview both pass no decide/comment permission, which is why they get an
   * informational card.
   */
  resolveActions(input: {
    state: ConversationApprovalCardState;
    approvalsModuleEnabled: boolean;
    permissions: { comment: boolean; decide: boolean };
  }): { canComment: boolean; canDecide: boolean; canOpenPreview: boolean };
};

/** The holder the timeline service reads. Empty until the join module fills it. */
@Injectable()
export class ClientConversationApprovalsRegistry {
  private port: ClientConversationApprovalsPort | null = null;

  register(port: ClientConversationApprovalsPort): void {
    this.port = port;
  }

  get(): ClientConversationApprovalsPort | null {
    return this.port;
  }
}
