import { Injectable } from '@nestjs/common';
import { LeadFlowBriefingJobStatus } from '../enums/leadflow-briefing-job-status.enum';

const { Queued, Processing, Succeeded, Failed, Cancelled, DeadLetter } =
  LeadFlowBriefingJobStatus;

/**
 * Pure transition table for the extraction job lifecycle — no DB access.
 * Kept separate from any worker so it's testable before F4-003 exists.
 */
@Injectable()
export class LeadFlowBriefingJobStateMachine {
  isLegalTransition(
    from: LeadFlowBriefingJobStatus,
    to: LeadFlowBriefingJobStatus,
    attempts: number,
    maxAttempts: number,
  ): boolean {
    switch (from) {
      case Queued:
        return to === Processing || to === Cancelled;
      case Processing:
        if (to === Succeeded || to === Cancelled) return true;
        if (to === Failed) {
          return true;
        }
        return false;
      case Failed:
        if (to === Queued) return attempts < maxAttempts;
        if (to === DeadLetter) return attempts >= maxAttempts;
        return false;
      case Succeeded:
      case Cancelled:
      case DeadLetter:
        return false;
      default:
        return false;
    }
  }

  assertTransition(
    from: LeadFlowBriefingJobStatus,
    to: LeadFlowBriefingJobStatus,
    attempts: number,
    maxAttempts: number,
  ): void {
    if (!this.isLegalTransition(from, to, attempts, maxAttempts)) {
      throw new Error(
        `Illegal LeadFlow briefing job transition: ${from} -> ${to} (attempts=${attempts}, maxAttempts=${maxAttempts}).`,
      );
    }
  }

  isTerminal(status: LeadFlowBriefingJobStatus): boolean {
    return status === Succeeded || status === Cancelled || status === DeadLetter;
  }
}
