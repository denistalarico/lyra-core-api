import { Injectable } from '@nestjs/common';
import type { SocialCopyGenerationRunStatus } from '../entities';

/**
 * Pure transition table for the copy generation run lifecycle — no database
 * access, so the legal-transition rules can be tested without a worker or a
 * connection.
 *
 * Same shape and same rules as `LeadFlowBriefingJobStateMachine`, because the
 * lifecycle genuinely is the same one: a queued attempt is claimed, it either
 * succeeds or fails, a failure returns to the queue until attempts run out and
 * then dead-letters, and the three terminal states are terminal.
 *
 * WHY `processing -> cancelled` IS LEGAL
 * -------------------------------------
 * E8 requires a cancellation policy. A run already in flight cannot recall the
 * HTTP request, so cancelling it means the result will be discarded rather than
 * staged for review — the provider call is sunk cost either way, and the
 * operator's intent ("do not change my content") is still honoured. Refusing
 * the transition would instead leave someone watching a progress spinner they
 * have no way to stop.
 */
@Injectable()
export class SocialCopyGenerationStateMachine {
  isLegalTransition(
    from: SocialCopyGenerationRunStatus,
    to: SocialCopyGenerationRunStatus,
    attempts: number,
    maxAttempts: number,
  ): boolean {
    switch (from) {
      case 'queued':
        return to === 'processing' || to === 'cancelled';
      case 'processing':
        return to === 'succeeded' || to === 'failed' || to === 'cancelled';
      case 'failed':
        if (to === 'queued') return attempts < maxAttempts;
        if (to === 'dead_letter') return attempts >= maxAttempts;
        return false;
      case 'succeeded':
      case 'cancelled':
      case 'dead_letter':
        return false;
      default:
        return false;
    }
  }

  assertTransition(
    from: SocialCopyGenerationRunStatus,
    to: SocialCopyGenerationRunStatus,
    attempts: number,
    maxAttempts: number,
  ): void {
    if (!this.isLegalTransition(from, to, attempts, maxAttempts))
      throw new Error(
        `Illegal social copy generation transition: ${from} -> ${to} (attempts=${attempts}, maxAttempts=${maxAttempts}).`,
      );
  }

  isTerminal(status: SocialCopyGenerationRunStatus): boolean {
    return (
      status === 'succeeded' ||
      status === 'cancelled' ||
      status === 'dead_letter'
    );
  }
}
