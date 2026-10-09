import { Injectable } from '@nestjs/common';
import type { SocialApprovalRequestEntity } from './entities';

/**
 * CS5-B — "an approval request changed status", for owner domains that keep a
 * projection of it (the Creative Studio reconciles the Planner state of the
 * content item whose selected version is the request's revision).
 *
 * Same seam as `ClientConversationCardRegistry` (CCOM2 §7) and for the same
 * reason: a registry declared and provided here is in the service's resolution
 * context by construction, and the arrow keeps pointing one way — this file
 * names a shape and never imports a consumer.
 *
 * Not a domain event and not a notification: the facts are still the
 * `social.approval.*` ones. Observers are told *after* the transition commits,
 * are best-effort (a failing observer never fails a decision), and must be
 * idempotent: they re-read their owners instead of trusting the payload, so a
 * missed call is repaired by the observer's own reconciliation.
 */
export type SocialApprovalTransitionObserver = (
  approval: SocialApprovalRequestEntity,
) => Promise<void>;

@Injectable()
export class SocialApprovalTransitionRegistry {
  private readonly observers: SocialApprovalTransitionObserver[] = [];

  register(observer: SocialApprovalTransitionObserver): void {
    this.observers.push(observer);
  }

  list(): readonly SocialApprovalTransitionObserver[] {
    return this.observers;
  }
}
