import type { SocialApprovalRequestEntity } from './entities';

/**
 * AP3 — the seam between the approvals domain and the Client Area email
 * channel.
 *
 * The domain publisher needs to tell eligible client memberships that
 * something waits on them, but the implementation of that lives behind the
 * Client Area stack. Depending on it directly would invert the arrow: every
 * consumer of the approvals domain would pull in Client Area authentication.
 *
 * So the domain declares the port, `ClientAreaApprovalsModule` binds it, and
 * the publisher injects it optionally: wired when the Client Area surface is
 * present, simply absent otherwise.
 */
export const CLIENT_APPROVAL_NOTIFIER = 'CLIENT_APPROVAL_NOTIFIER';

export type ClientApprovalNotificationType =
  | 'awaiting_client'
  | 'superseded'
  | 'cancelled'
  /**
   * AP4 §24/§25 — an Agency operator replied with `visibility='client'`.
   * Reuses this same port/channel rather than inventing a second messaging
   * taxonomy: a comment is not an approval-status transition, but the
   * delivery mechanics (email-only, membership-resolved, ledger-deduped) are
   * identical, so it travels through the same `ClientApprovalNotifier`.
   */
  | 'agency_reply';

export type ClientApprovalNotifier = {
  publish(
    type: ClientApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
    /**
     * AP4 — present only for `agency_reply`: disambiguates two replies on the
     * same approval, which otherwise could not both pass the ledger's
     * `(tenant, sourceEventId, user)` uniqueness within the same transition
     * moment. Every other event type keeps deriving its moment from the
     * approval's own timestamp columns, unchanged from AP3.
     */
    event?: { id: string; occurredAt: Date },
  ): Promise<void>;
};
