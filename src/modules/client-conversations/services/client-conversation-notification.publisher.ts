import { Injectable, Logger } from '@nestjs/common';
import { IsNull, Not, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
  NotificationRecipientSurface,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import type {
  NotificationClientAudience,
  NotificationExplicitRecipient,
} from '../../notifications/types';
import { ClientConversationParticipantEntity } from '../entities';

const AGENCY_CONNECTION = 'agency';

/** The message that was just persisted, as the publisher needs it. */
export type ClientConversationMessageNotice = {
  tenantId: string;
  workspaceId: string;
  companyContextId: string;
  conversationId: string;
  messageId: string;
  /** Which surface wrote it. */
  authorSurface: NotificationRecipientSurface;
  authorUserId: string;
  createdAt: Date;
};

/**
 * NTF-C1 §39/§40/§41 — "a new message is waiting for you" in a Client
 * Conversation.
 *
 * ONE PUBLISHER, BOTH DIRECTIONS
 * ------------------------------
 * §40 is explicit that a second publisher must not exist, and the event is
 * symmetric, so direction is a *parameter* rather than a branch of
 * architecture:
 *
 *   Agency writes → recipients are the company's eligible Client Area members
 *   Client writes → recipients are the conversation's Agency participants
 *
 * Both publish `client_conversation.message.created`, whose definition is
 * `audience='both'`; the core resolves each surface's recipients its own way.
 *
 * THE AUTHOR IS NEVER A RECIPIENT
 * -------------------------------
 * Twice over, deliberately (§42): the author's own surface is not addressed at
 * all, and the event carries `actorUserId`, so the catalog's
 * `SUPPRESS_ACTOR` policy also removes them. The second guard matters for the
 * case the first misses — an operator who is also a member of the very company
 * they just wrote to would otherwise be notified by their own message.
 *
 * NOTIFICATION FAILURE NEVER BREAKS THE CONVERSATION (§70)
 * --------------------------------------------------------
 * The message is already persisted and already broadcast when this runs, and
 * every error is swallowed here. A notification is a pointer to a fact; losing
 * the pointer must not cast doubt on the fact.
 */
@Injectable()
export class ClientConversationNotificationPublisher {
  private readonly logger = new Logger(
    ClientConversationNotificationPublisher.name,
  );

  constructor(
    private readonly notifications: NotificationEventProcessorService,
    @InjectRepository(ClientConversationParticipantEntity, AGENCY_CONNECTION)
    private readonly participants: Repository<ClientConversationParticipantEntity>,
  ) {}

  async publishMessageCreated(
    notice: ClientConversationMessageNotice,
  ): Promise<void> {
    try {
      const fromClient =
        notice.authorSurface === NotificationRecipientSurface.CLIENT_AREA;

      await this.notifications.process({
        // §11/§26 — the message id is the event's identity, so a retried
        // publication of one message cannot create a second notification.
        eventId: `client_conversation.message.created:${notice.messageId}`,
        eventType: 'client_conversation.message.created',
        tenantId: notice.tenantId,
        workspaceId: notice.workspaceId,
        productKey: NotificationProductKey.SOCIAL,
        moduleKey: 'conversations',
        actorType: NotificationActorType.USER,
        // Feeds `SUPPRESS_ACTOR`; see the header.
        actorUserId: notice.authorUserId,
        resourceType: 'client_conversation',
        resourceId: notice.conversationId,
        occurredAt: notice.createdAt.toISOString(),
        recipients: fromClient
          ? await this.agencyParticipants(notice)
          : // An Agency-authored message addresses only the client surface.
            [],
        clientAudience: fromClient ? undefined : this.clientAudience(notice),
        payload: {
          title: 'Nova mensagem',
          body: fromClient
            ? 'O cliente enviou uma nova mensagem.'
            : 'A agência enviou uma nova mensagem.',
          // The Agency deep link; the client one lives in `clientAudience`.
          actionUrl: `/client-area-management/conversations?conversationId=${encodeURIComponent(
            notice.conversationId,
          )}`,
          conversationId: notice.conversationId,
          companyContextId: notice.companyContextId,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to publish conversation message notification for ${notice.messageId}: ${
          error instanceof Error ? error.message : 'unknown_error'
        }`,
      );
    }
  }

  /**
   * §16 — the client lands on the conversation inside their own company.
   *
   * The message body is deliberately absent from the notification: the
   * conversation is the record and the notification is a pointer to it (CCOM0
   * §28), so the text is read in session, where access is re-proved.
   */
  private clientAudience(
    notice: ClientConversationMessageNotice,
  ): NotificationClientAudience {
    return {
      companyContextId: notice.companyContextId,
      requiredPermission: 'client_area.conversations.view',
      requiredModule: 'conversations',
      interestReason: NotificationInterestReason.PARTICIPANT,
      actionUrl: `/client-area/companies/${encodeURIComponent(
        notice.companyContextId,
      )}/conversations`,
      title: 'Nova mensagem da agência',
      body: 'A agência enviou uma nova mensagem na sua conversa.',
    };
  }

  /**
   * §40 — the Agency recipients are the conversation's live Agency
   * participants, which is the Agency side's own access record. Resolved from
   * the participant table rather than from a permission sweep, so a message
   * notifies the operators actually in the thread.
   */
  private async agencyParticipants(
    notice: ClientConversationMessageNotice,
  ): Promise<NotificationExplicitRecipient[]> {
    const rows = await this.participants.find({
      where: {
        conversationId: notice.conversationId,
        participantSurface: 'agency',
        leftAt: IsNull(),
        userId: Not(IsNull()),
      },
    });

    return rows
      .filter((row) => row.userId && row.userId !== notice.authorUserId)
      .map((row) => ({
        userId: row.userId,
        interestReason: NotificationInterestReason.PARTICIPANT,
        surface: NotificationRecipientSurface.AGENCY,
      }));
  }
}
