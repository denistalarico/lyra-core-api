import { Injectable } from '@nestjs/common';
import type { ApprovalDecisionRecord } from './client-conversation-card.port';
import type { SocialApprovalRequestEntity } from './entities';

/**
 * AR5 — the seam to the Team Chat, a registry for the reason given in
 * `client-conversation-card.port.ts`: this module declares what it needs and
 * the join module (`SocialApprovalsTeamChatModule`) fills it. Empty means no
 * Team Chat surface wired, and every call below is then skipped.
 *
 * None of these may fail a transition: the implementation logs and returns.
 */
export type TeamChatApprovalCardPublisher = {
  publishCard(input: {
    approval: SocialApprovalRequestEntity;
    channelId: string;
    dedupeKey: string;
  }): Promise<void>;

  /** The decision as a reply to the card, once per event (entrega 6). */
  publishDecisionReply(input: {
    approval: SocialApprovalRequestEntity;
    record: ApprovalDecisionRecord;
  }): Promise<void>;

  /** R-21: tells open channels to re-read the card. */
  announceCardChanged(approval: SocialApprovalRequestEntity): Promise<void>;
};

@Injectable()
export class TeamChatApprovalCardRegistry {
  private publisher: TeamChatApprovalCardPublisher | null = null;

  register(publisher: TeamChatApprovalCardPublisher): void {
    this.publisher = publisher;
  }

  get(): TeamChatApprovalCardPublisher | null {
    return this.publisher;
  }
}
