import { Injectable } from '@nestjs/common';
import type { SocialApprovalRequestEntity } from './entities';

/**
 * AP3/NTF-C1 — the seam between the approvals domain and the Client Area.
 *
 * WHAT THIS USED TO BE, AND WHY IT CHANGED
 * ----------------------------------------
 * This file declared `CLIENT_APPROVAL_NOTIFIER` as an injection token, bound
 * by `ClientAreaApprovalsModule` and injected into
 * `SocialApprovalNotificationPublisher` with `@Optional() @Inject(TOKEN)`.
 * The publisher is declared by `SocialApprovalsModule`, and Nest resolves a
 * provider's dependencies in the module that declares it — so the binding was
 * never in the publisher's resolution context. The injection landed as
 * `undefined`, the `if (!this.clientNotifications) return;` guard took the
 * early exit, and **every client approval notification from AP3 onward was
 * dropped with no error anywhere**. CCOM2 §24.1 suspected it; NTF-C1 §1
 * proved it in `ap3-client-notifier-wiring.spec.ts` before changing anything.
 *
 * It is now a registry: a plain provider of the module that declares the
 * consumer, so it always resolves, filled on init by the joining module.
 * Whether it holds an implementation is an observable fact with a wiring spec
 * on it, instead of an invisible property of the module graph. Same pattern as
 * CCOM2's `ClientConversationCardRegistry` — one pattern for ports in this
 * codebase, not three.
 *
 * WHAT THE IMPLEMENTATION DOES NOW
 * --------------------------------
 * It no longer *sends* anything. NTF-C1 §3/§10 retires the parallel pipeline:
 * the implementation publishes into the Notifications Core, which owns
 * recipients, idempotency, in-app, realtime, email, push and the delivery
 * record. The domain still decides *when* a client should be told, which is
 * the only thing it legitimately knows.
 */
export type ClientApprovalNotificationType =
  | 'awaiting_client'
  | 'superseded'
  | 'cancelled'
  /**
   * AP4 §24/§25 — an Agency operator replied with `visibility='client'`.
   * Reuses this same seam rather than inventing a second taxonomy: a comment
   * is not an approval-status transition, but the audience and the delivery
   * mechanics are identical.
   */
  | 'agency_reply';

export type ClientApprovalNotifier = {
  publish(
    type: ClientApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
    /**
     * AP4 — present only for `agency_reply`: disambiguates two replies on the
     * same approval, which otherwise could not both pass the source-event
     * uniqueness within the same transition moment. Every other type derives
     * its moment from the approval's own timestamp columns.
     */
    event?: { id: string; occurredAt: Date },
  ): Promise<void>;
};

/**
 * Declared and provided by `SocialApprovalsModule`, so it is always inside
 * `SocialApprovalNotificationPublisher`'s resolution context. Filled by
 * `ClientAreaApprovalsModule` on init.
 */
@Injectable()
export class ClientApprovalNotifierRegistry {
  private implementation: ClientApprovalNotifier | null = null;

  register(implementation: ClientApprovalNotifier): void {
    this.implementation = implementation;
  }

  /**
   * Null means the Client Area approvals surface is not wired in this process.
   * The caller logs that and continues — degradation that is visible, unlike
   * the token it replaces.
   */
  get(): ClientApprovalNotifier | null {
    return this.implementation;
  }
}
