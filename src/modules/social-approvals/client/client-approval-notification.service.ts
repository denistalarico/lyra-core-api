import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import type { NotificationClientAudience } from '../../notifications/types';
import type { SocialApprovalRequestEntity } from '../entities';
import type {
  ClientApprovalNotificationType,
  ClientApprovalNotifier,
} from '../client-approval-notifier.port';

export type { ClientApprovalNotificationType };

/**
 * NTF-C1 §3/§10/§35 — the client-only approval events, now published into the
 * Notifications Core.
 *
 * WHAT THIS SERVICE USED TO BE
 * ----------------------------
 * AP3's second delivery pipeline: it resolved client memberships, claimed a
 * row in `client_area_approval_notifications`, rendered an email and sent it
 * through `EmailService` — a complete parallel notification system whose
 * deliveries were invisible to `notification_deliveries`.
 *
 * Two things were wrong with that, and NTF-C1 fixes both:
 *
 *   1. it never ran. The port binding it to the domain publisher was an
 *      injection token bound in the wrong module, so the publisher's
 *      `@Optional()` injection was `undefined` and every call was a no-op
 *      (§1, proved in `ap3-client-notifier-wiring.spec.ts`);
 *   2. even working, it was a second subsystem — its own recipients, its own
 *      idempotency, its own ledger, no in-app, no realtime, no push.
 *
 * WHAT IT IS NOW
 * --------------
 * A *resolver of intent*, not a sender. It knows which approval transitions
 * concern a client and what the client should read; the core owns everything
 * else. The recipient rules it used to implement inline now live in
 * `ClientNotificationSurfaceService` — moved, not rewritten (§8), because
 * those rules were the valuable, tested part.
 *
 * WHY IT STILL EXISTS AT ALL
 * --------------------------
 * `cancelled` and `agency_reply` have no Agency catalog event: a cancellation
 * is the operator's own action and a reply is a comment, not a status
 * transition. So they cannot ride along on an Agency `process()` call the way
 * `awaiting_client` and `superseded` now do — they need a publication of their
 * own, with a client-only audience. That is this service's whole remaining
 * job.
 *
 * THE LEDGER (§49)
 * ----------------
 * `client_area_approval_notifications` is no longer written. The table and its
 * rows are kept: they are the record of the AP3 era, and a destructive
 * migration here would delete history to tidy a schema. Idempotency now comes
 * from the core's `unique (tenant_id, source_event_id)` plus
 * `unique (notification_id, recipient_surface, user_id)` — and the
 * `sourceEventId` strings are byte-for-byte the ones the ledger used, so the
 * two eras remain correlatable.
 */
@Injectable()
export class ClientApprovalNotificationService implements ClientApprovalNotifier {
  private readonly logger = new Logger(ClientApprovalNotificationService.name);

  constructor(
    private readonly notifications: NotificationEventProcessorService,
  ) {}

  async publish(
    type: ClientApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
    event?: { id: string; occurredAt: Date },
  ): Promise<void> {
    // AP3's rule, preserved: nothing the client was never shown is worth
    // telling them about.
    if (!approval.sentToClientAt) return;

    // `awaiting_client` and `superseded` are published by the Agency path as
    // one notification addressing both audiences (§27). Routing them here too
    // would create a second notification for the same fact — a different
    // `source_event_id`, so the unique index would not catch it.
    if (type !== 'cancelled' && type !== 'agency_reply') return;

    try {
      await this.notifications.process({
        eventId: this.sourceEventId(type, approval, event),
        eventType: `social.approval.${type}`,
        tenantId: approval.tenantId,
        workspaceId: approval.workspaceId,
        productKey: NotificationProductKey.SOCIAL,
        moduleKey: 'approvals',
        actorType: NotificationActorType.SYSTEM,
        resourceType: 'social_approval_request',
        resourceId: approval.id,
        occurredAt: this.occurredAt(type, approval, event).toISOString(),
        // No Agency recipients: these two events are client-only, and the
        // definition's `audience='client_area'` makes that structural.
        recipients: [],
        clientAudience: this.audience(type, approval),
        payload: {
          title: CLIENT_COPY[type].title,
          body: CLIENT_COPY[type].body(approval),
          approvalId: approval.id,
          companyContextId: approval.companyContextId,
        },
      });
    } catch (error) {
      // A notification problem must never roll back an approval transition
      // that already happened.
      this.logger.error(
        `Failed to publish client approval notification ${type} for ${approval.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private audience(
    type: ClientApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
  ): NotificationClientAudience {
    return {
      companyContextId: approval.companyContextId,
      requiredPermission: 'client_area.approvals.view',
      requiredModule: 'approvals',
      interestReason: NotificationInterestReason.APPROVER,
      // §16 — always the Client Area route.
      actionUrl: `/client-area/companies/${encodeURIComponent(
        approval.companyContextId,
      )}/approvals/${encodeURIComponent(approval.id)}`,
      title: CLIENT_COPY[type].title,
      body: CLIENT_COPY[type].body(approval),
    };
  }

  /**
   * Byte-for-byte AP3's key, so the pre- and post-migration eras line up and a
   * replayed event cannot produce a second notification.
   */
  private sourceEventId(
    type: ClientApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
    event?: { id: string; occurredAt: Date },
  ): string {
    // AP4 — a reply is a comment, not a transition: there is no timestamp
    // column for it and two replies could collide on `updatedAt`, so the
    // comment's own id is the identity.
    if (type === 'agency_reply' && event) {
      return `client_area.approval.${type}:${approval.id}:${event.id}`;
    }
    return `client_area.approval.${type}:${approval.id}:${this.occurredAt(
      type,
      approval,
      event,
    ).toISOString()}`;
  }

  private occurredAt(
    type: ClientApprovalNotificationType,
    approval: SocialApprovalRequestEntity,
    event?: { id: string; occurredAt: Date },
  ): Date {
    return (
      (type === 'cancelled' && approval.cancelledAt) ||
      event?.occurredAt ||
      approval.updatedAt ||
      new Date()
    );
  }
}

/**
 * The client-facing wording, carried over from AP3's renderer so the customer
 * reads the same thing after the pipeline change.
 *
 * `agency_reply` deliberately contains neither the operator's name nor the
 * comment text (AP4 §25/§31): the notification says something was said and
 * sends the person to read it in session.
 */
const CLIENT_COPY: Record<
  ClientApprovalNotificationType,
  { title: string; body: (approval: SocialApprovalRequestEntity) => string }
> = {
  awaiting_client: {
    title: 'Uma aprovação aguarda você',
    body: (approval) =>
      `${approval.title} (${approval.subjectVersionLabel}) foi enviado para a sua aprovação.`,
  },
  superseded: {
    title: 'Uma nova versão substituiu esta',
    body: (approval) =>
      `${approval.title} (${approval.subjectVersionLabel}) foi substituído por uma versão mais recente.`,
  },
  cancelled: {
    title: 'Uma aprovação foi cancelada',
    body: (approval) =>
      `${approval.title} (${approval.subjectVersionLabel}) não precisa mais da sua avaliação.`,
  },
  agency_reply: {
    title: 'A agência respondeu',
    body: (approval) =>
      `A agência respondeu sobre ${approval.title} (${approval.subjectVersionLabel}).`,
  },
};
