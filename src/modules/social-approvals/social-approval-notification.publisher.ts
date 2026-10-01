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
  ) {}

  async publish(
    type: SocialApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
    actorUserId: string | null,
  ): Promise<void> {
    await Promise.all([
      this.publishToAgency(type, approval, actorUserId),
      this.publishToClient(type, approval),
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

  private async publishToAgency(
    type: SocialApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
    actorUserId: string | null,
  ): Promise<void> {
    const occurredAt = this.occurredAt(type, approval);
    try {
      await this.notifications.process({
        eventId: `social.approval.${type}:${approval.id}:${occurredAt.toISOString()}`,
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
