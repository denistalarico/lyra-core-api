import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../notifications/enums';
import { NotificationEventProcessorService } from '../notifications/services';
import { type SocialApprovalRequestEntity } from './entities';
import {
  CLIENT_APPROVAL_NOTIFIER,
  type ClientApprovalNotificationType,
  type ClientApprovalNotifier,
} from './client-approval-notifier.port';
import { ClientConversationCardRegistry } from './client-conversation-card.port';

export type SocialApprovalNotificationType =
  | 'awaiting_client'
  | 'changes_requested'
  | 'approved'
  | 'superseded';

/**
 * The shared notification processor owns catalog validation, delivery and its
 * source-event idempotency for the **Agency** audience.
 *
 * AP3 adds the client audience without duplicating the taxonomy (§48): the
 * same transitions publish here, and this one publisher fans out to the two
 * channels that actually exist — the shared Agency stack for the requester,
 * and the Client Area email channel for eligible memberships. Agency
 * notifications are unchanged; nothing is sent twice to the same person,
 * because the two audiences are disjoint by construction (an Agency operator
 * cannot hold a Client Area membership).
 */
@Injectable()
export class SocialApprovalNotificationPublisher {
  private readonly logger = new Logger(SocialApprovalNotificationPublisher.name);

  constructor(
    private readonly notifications: NotificationEventProcessorService,
    @Optional()
    @Inject(CLIENT_APPROVAL_NOTIFIER)
    private readonly clientNotifications?: ClientApprovalNotifier,
    /**
     * CCOM2 §7 — the conversation timeline, as a third audience of the same
     * single fan-out point (CCOM0 §27).
     *
     * A registry rather than an optional token: a token bound by the join
     * module would not be in this provider's resolution context and would
     * silently inject `undefined` (see the port's note). The registry is
     * provided by this module, so it always resolves; whether it holds an
     * implementation is what says if the surface is wired.
     */
    @Optional()
    private readonly conversationCards?: ClientConversationCardRegistry,
  ) {}

  async publish(
    type: SocialApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
    actorUserId: string | null,
  ): Promise<void> {
    await Promise.all([
      this.publishToAgency(type, approval, actorUserId),
      this.publishToClient(type, approval),
      this.publishToConversation(type, approval),
    ]);
  }

  /**
   * A transition the Agency catalog has no event for, but the client should
   * still hear about (§49: a cancelled request they were already asked to
   * review; AP4 §24: an Agency operator's explicit client-visible reply, which
   * is a comment, not an approval-status transition, so it has no Agency
   * catalog event either). Kept separate so it cannot be mistaken for a new
   * Agency event.
   */
  async publishClientOnly(
    type: ClientApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
    event?: { id: string; occurredAt: Date },
  ): Promise<void> {
    await this.clientNotifications?.publish(type, approval, event);
  }

  /**
   * Client-facing transitions only. `approved`/`changes_requested` are the
   * client's *own* decisions — mailing someone about what they just did is
   * noise — so they stay Agency-only, exactly as AP2 had them.
   */
  private async publishToClient(
    type: SocialApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
  ): Promise<void> {
    if (!this.clientNotifications) return;
    if (type !== 'awaiting_client' && type !== 'superseded') return;
    await this.clientNotifications.publish(type, approval);
  }

  /**
   * CCOM2 §7/§8/§9 — the conversation card.
   *
   * ONLY `awaiting_client` PUBLISHES A CARD
   * --------------------------------------
   * The card announces "there is something new for you to review", which is
   * what that one transition means. `approved` and `changes_requested` are the
   * client's own decisions and `superseded` is resolved on read by the card
   * that already exists — §30/§52 require that a decision never create a second
   * card, and the cleanest way to guarantee that is for no other transition to
   * reach this method at all. Each new revision is a *different* approval and
   * therefore its own `awaiting_client` event, which is why a replacement chain
   * still produces one card per revision (§51/§52).
   *
   * THE DEDUPE KEY IS THE EVENT'S OWN IDENTITY
   * ------------------------------------------
   * Byte-for-byte the `eventId` the Agency ledger deduplicates on, built from
   * the same `occurredAt()`. So a retried publication of one event cannot
   * produce a second card (§9/§51), and the card's idempotency cannot drift
   * from the notification's — there is one key, not two derivations of one.
   */
  private async publishToConversation(
    type: SocialApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
  ): Promise<void> {
    if (type !== 'awaiting_client') return;

    const cards = this.conversationCards?.get();
    if (!cards) return;

    try {
      await cards.publishApprovalCard({
        approval,
        dedupeKey: this.eventIdFor(type, approval),
      });
    } catch (error) {
      // §10 — the transition is the fact and the card is an effect; a failure
      // to post must never fail the approval. The implementation already
      // swallows its own errors, so reaching here means something unexpected.
      this.logger.error(
        `Failed to project approval card for ${approval.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * CCOM2 §43/§45 — tells the conversation timeline that an approval changed
   * without a conversation row being written.
   *
   * Called for a client-visible comment and for a decision. Not a notification
   * and not a card: no row is created, nothing is deduplicated, and the only
   * effect is that open timelines re-read.
   */
  async announceConversationActivity(
    approval: SocialApprovalRequestEntity,
    reason: 'comment_created' | 'decision_changed',
  ): Promise<void> {
    const cards = this.conversationCards?.get();
    if (!cards) return;
    try {
      await cards.announceApprovalActivity({ approval, reason });
    } catch (error) {
      this.logger.warn(
        `Failed to announce approval activity for ${approval.id}: ${
          error instanceof Error ? error.message : 'unknown_error'
        }`,
      );
    }
  }

  /** The event's identity, shared by the ledger and the card's dedupe key. */
  private eventIdFor(
    type: SocialApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
  ): string {
    return `social.approval.${type}:${approval.id}:${this.occurredAt(
      type,
      approval,
    ).toISOString()}`;
  }

  private async publishToAgency(
    type: SocialApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
    actorUserId: string | null,
  ): Promise<void> {
    const occurredAt = this.occurredAt(type, approval);
    try {
      await this.notifications.process({
        // Shared with the conversation card's dedupe key (§9), so one event
        // cannot produce one notification and two cards.
        eventId: this.eventIdFor(type, approval),
        eventType: `social.approval.${type}`,
        tenantId: approval.tenantId,
        workspaceId: approval.workspaceId,
        productKey: NotificationProductKey.SOCIAL,
        moduleKey: 'approvals',
        actorType: actorUserId
          ? NotificationActorType.USER
          : NotificationActorType.SYSTEM,
        actorUserId,
        resourceType: 'social_approval_request',
        resourceId: approval.id,
        occurredAt: occurredAt.toISOString(),
        recipients: [{
          userId: approval.requestedByUserId,
          interestReason: NotificationInterestReason.REQUESTER,
        }],
        payload: {
          title: this.titleFor(type, approval),
          body: this.bodyFor(type, approval),
          actionUrl: `/social/approvals?approvalId=${encodeURIComponent(approval.id)}`,
          approvalId: approval.id,
          subjectType: approval.subjectType,
          subjectTitle: approval.title,
          subjectVersionLabel: approval.subjectVersionLabel,
          status: approval.status,
          companyContextId: approval.companyContextId,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish social.approval.${type} for ${approval.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private occurredAt(
    type: SocialApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
  ) {
    return (
      (type === 'awaiting_client' && approval.sentToClientAt) ||
      (type === 'approved' && approval.approvedAt) ||
      (type === 'superseded' && approval.supersededAt) ||
      approval.updatedAt ||
      new Date()
    );
  }

  private titleFor(
    type: SocialApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
  ) {
    const titles: Record<SocialApprovalNotificationType, string> = {
      awaiting_client: 'Aprovação aguardando cliente',
      changes_requested: 'Alterações solicitadas na aprovação',
      approved: 'Aprovação concluída',
      superseded: 'Aprovação substituída por nova revisão',
    };
    return titles[type];
  }

  private bodyFor(
    type: SocialApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
  ) {
    return `${approval.title} (${approval.subjectVersionLabel}): ${this.titleFor(type, approval)}.`;
  }
}
