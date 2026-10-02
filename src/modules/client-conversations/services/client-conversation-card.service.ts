import { Injectable, Logger } from '@nestjs/common';
import { ClientAreaManagementService } from '../../client-area/services/client-area-management.service';
import type { ClientConversationCardPublisher } from '../../social-approvals/client-conversation-card.port';
import type { SocialApprovalRequestEntity } from '../../social-approvals/entities';
import { AgencyClientConversationsGateway } from '../gateways/agency-client-conversations.gateway';
import { ClientConversationsGateway } from '../gateways/client-conversations.gateway';
import type { ClientConversationScope } from './client-conversation-access';
import { ClientConversationsService } from './client-conversations.service';

/**
 * CCOM2 §7/§10/§44 — publishes the approval card into the conversation.
 *
 * Lives on the conversations side because it writes
 * `client_conversation_messages` and broadcasts on this domain's rooms; the
 * approvals domain reaches it through `CLIENT_CONVERSATION_CARD_PUBLISHER` and
 * never imports it (see the port's note on the direction of the arrow).
 *
 * TYPE-ONLY IMPORT OF THE APPROVAL ENTITY
 * ---------------------------------------
 * `SocialApprovalRequestEntity` is imported as a *type*, so nothing of the
 * approvals module is loaded at runtime by this file. The approval arrives
 * already fetched by the publisher that owns the transition; this service reads
 * four of its fields and never queries approvals itself.
 *
 * WHY A TRANSITION IS NEVER FAILED BY A CARD (§10)
 * ------------------------------------------------
 * An approval moving to `awaiting_client` is the fact; the card is an effect.
 * Every failure mode here — conversations switched off for the company, no
 * conversation yet, a broadcast that cannot reach a room — resolves to a logged
 * `skipped` rather than an exception, because the alternative is that a client
 * cannot be sent work for review due to a messaging side effect.
 */
@Injectable()
export class ClientConversationCardService implements ClientConversationCardPublisher {
  private readonly logger = new Logger(ClientConversationCardService.name);

  constructor(
    private readonly conversations: ClientConversationsService,
    private readonly management: ClientAreaManagementService,
    private readonly clientRealtime: ClientConversationsGateway,
    private readonly agencyRealtime: AgencyClientConversationsGateway,
  ) {}

  async publishApprovalCard(input: {
    approval: SocialApprovalRequestEntity;
    dedupeKey: string;
  }): Promise<{ status: 'posted' | 'duplicate' | 'skipped' }> {
    try {
      const scope = this.scopeOf(input.approval);
      if (!scope) return { status: 'skipped' };

      /**
       * §10 — the company's **conversations** module gates the card, because
       * the card is a conversation row. A company that has not switched
       * conversations on gets no card at all; the approval still reaches the
       * client through the approvals module and the email channel, which is the
       * behaviour that was already true before CCOM2.
       */
      const modules = await this.management.resolveCompanyModules(scope);
      if (!modules.conversations) return { status: 'skipped' };

      const result = await this.conversations.publishCard(
        scope,
        {
          kind: 'approval_card',
          approvalId: input.approval.id,
          title: input.approval.title,
          version: input.approval.subjectVersionLabel,
        },
        input.dedupeKey,
      );

      // §44 — both rooms learn immediately; a card must not wait for the next
      // poll to appear in a thread someone is looking at.
      if (result.status === 'posted' && result.conversationId) {
        this.broadcastMessage(scope, result.conversationId, result.message);
      }

      return { status: result.status };
    } catch (error) {
      this.logger.error(
        `Failed to publish approval card for ${input.approval.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { status: 'skipped' };
    }
  }

  /**
   * §43/§45 — the timeline changed without a conversation row being written.
   *
   * A client-visible approval comment is canonical in
   * `social_approval_comments` (CCOM0 §13) and a decision changes an approval's
   * status, which the card resolves on read. In both cases the correct realtime
   * signal is "re-read the timeline", not a payload: sending the comment itself
   * would mean this broadcast had to carry a client-safe projection of it, which
   * is a second projector, and sending a status would persist nothing but still
   * invite the UI to cache it.
   */
  async announceApprovalActivity(input: {
    approval: SocialApprovalRequestEntity;
    reason: 'comment_created' | 'decision_changed';
  }): Promise<void> {
    try {
      const scope = this.scopeOf(input.approval);
      if (!scope) return;

      const conversationId =
        await this.conversations.findDefaultConversationId(scope);
      if (!conversationId) return;

      const payload = {
        tenantId: scope.tenantId,
        companyContextId: scope.companyContextId,
        conversationId,
        approvalId: input.approval.id,
        reason: input.reason,
      };
      this.clientRealtime.broadcastTimelineChanged(payload);
      this.agencyRealtime.broadcastTimelineChanged(payload);
    } catch (error) {
      this.logger.warn(
        `Approval activity broadcast failed for ${input.approval.id}: ${
          error instanceof Error ? error.message : 'unknown_error'
        }`,
      );
    }
  }

  /**
   * The conversation scope of an approval.
   *
   * All four ids come off the approval row itself, which carries the same
   * tuple this domain uses. `null` when the row is missing one — impossible
   * under the entity's NOT NULLs, but the check keeps a partially-built test
   * fixture from producing a query with an undefined id.
   */
  private scopeOf(
    approval: SocialApprovalRequestEntity,
  ): ClientConversationScope | null {
    if (
      !approval.tenantId ||
      !approval.workspaceId ||
      !approval.agencyClientId ||
      !approval.companyContextId
    ) {
      return null;
    }

    return {
      tenantId: approval.tenantId,
      workspaceId: approval.workspaceId,
      agencyClientId: approval.agencyClientId,
      companyContextId: approval.companyContextId,
    };
  }

  private broadcastMessage(
    scope: ClientConversationScope,
    conversationId: string,
    message: unknown,
  ) {
    const payload = {
      tenantId: scope.tenantId,
      companyContextId: scope.companyContextId,
      conversationId,
      message,
    };
    this.clientRealtime.broadcastMessageCreated(payload);
    this.agencyRealtime.broadcastMessageCreated(payload);
  }
}
