import { Injectable } from '@nestjs/common';
import type { SocialApprovalRequestEntity } from './entities';

/**
 * CCOM2 §7 — the seam between the approvals domain and the Client Conversation
 * timeline.
 *
 * When an approval enters `awaiting_client`, the conversation of the same
 * Company Context should carry a card for it. The publication itself belongs to
 * the conversations domain — it writes `client_conversation_messages` and
 * broadcasts on that domain's realtime rooms — so the approvals domain declares
 * what it needs and never imports it.
 *
 * WHY THIS IS A REGISTRY AND NOT AN INJECTION TOKEN
 * -------------------------------------------------
 * The obvious shape is `@Optional() @Inject(TOKEN)` on the publisher, bound by
 * a third module that imports both domains. It does not work, and it fails
 * *silently*: Nest resolves a provider's dependencies in the module that
 * **declares** that provider, so a token bound in a third module is simply not
 * in the publisher's resolution context and the optional injection lands as
 * `undefined`. Verified against this repo's Nest version with a throwaway
 * module before choosing (`AP3`'s `CLIENT_APPROVAL_NOTIFIER` has exactly this
 * shape and therefore exactly this problem — recorded as debt, not changed
 * here).
 *
 * A registry declared and provided by *this* module is in the publisher's
 * context by construction. The join module fills it on init. The arrow still
 * points one way: this file names a shape, and nothing here imports the
 * conversations domain.
 *
 * WHY NO NEW DOMAIN EVENT (§8)
 * ----------------------------
 * The fact of domain is `social.approval.awaiting_client`, already in the
 * catalog. The card is an *effect* of that fact, published by the same single
 * fan-out point (CCOM0 §27). A `client_conversation.approval.attached` event
 * would be an event about an effect, and would create a second source of
 * idempotency for one thing.
 */
export type ClientConversationCardPublisher = {
  /**
   * Publishes the approval card into the company's default conversation,
   * idempotently per `dedupeKey`.
   *
   * Never throws into the caller: a transition must not fail because a card
   * could not be posted (§10). The implementation logs and returns a status.
   */
  publishApprovalCard(input: {
    approval: SocialApprovalRequestEntity;
    /**
     * The identity of the originating event, reused verbatim as the card's
     * dedupe key (§9) — the same `source_event_id` the notification ledger
     * uses, so one event cannot produce one notification and two cards.
     */
    dedupeKey: string;
  }): Promise<{ status: 'posted' | 'duplicate' | 'skipped' }>;

  /**
   * A client-visible approval comment was created, or a decision changed an
   * approval's status, so the timeline changed without a conversation row being
   * written (§43/§45). Broadcasts only; the comment stays canonical in
   * `social_approval_comments` and the status is never persisted.
   */
  announceApprovalActivity(input: {
    approval: SocialApprovalRequestEntity;
    reason: 'comment_created' | 'decision_changed';
  }): Promise<void>;
};

/**
 * The holder the publisher reads. Empty until the join module fills it, and an
 * empty registry means "no conversation surface wired" — the approvals domain
 * then behaves exactly as it did before CCOM2.
 */
@Injectable()
export class ClientConversationCardRegistry {
  private publisher: ClientConversationCardPublisher | null = null;

  register(publisher: ClientConversationCardPublisher): void {
    this.publisher = publisher;
  }

  get(): ClientConversationCardPublisher | null {
    return this.publisher;
  }
}
