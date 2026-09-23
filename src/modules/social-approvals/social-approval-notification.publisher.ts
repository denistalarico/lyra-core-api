import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../notifications/enums';
import { NotificationEventProcessorService } from '../notifications/services';
import { type SocialApprovalRequestEntity } from './entities';

export type SocialApprovalNotificationType =
  | 'awaiting_client'
  | 'changes_requested'
  | 'approved'
  | 'superseded';

/**
 * The shared notification processor owns catalog validation, delivery and its
 * source-event idempotency. AP2 never guesses a Client Area recipient: all
 * events here are for the known agency requester.
 */
@Injectable()
export class SocialApprovalNotificationPublisher {
  private readonly logger = new Logger(SocialApprovalNotificationPublisher.name);

  constructor(
    private readonly notifications: NotificationEventProcessorService,
  ) {}

  async publish(
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
