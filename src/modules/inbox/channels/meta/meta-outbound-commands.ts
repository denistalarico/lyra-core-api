import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { RequestContext } from '../../../../common/context/request-context.interface';
import type { InboxConversationEntity } from '../../entities/inbox-conversation.entity';
import type { InboxMessageEntity } from '../../entities/inbox-message.entity';

/**
 * Commands the Instagram and Messenger services accept besides the composer's
 * own sends. Both channels take exactly the same shape, so it is declared once.
 */
export type SendMetaAutomationMessageInput = {
  tenantId: string;
  workspaceId: string;
  conversationId: string;
  automationId: string;
  idempotencyKey: string;
  text?: string | null;
  connectionRef?: string | null;
};

/**
 * A follow-up a *person* sends from the reminder (D-IX-3/D-IX-9). It does not
 * take the conversation from the agent: the person nudges the lead and, if the
 * lead answers, the agent carries on.
 */
export type SendMetaFollowUpTextInput = {
  ctx: RequestContext;
  conversationId: string;
  text: string;
  idempotencyKey: string;
  stepKey: string;
  /** The cadence this attempt belongs to, so the chain survives the send. */
  automationId: string | null;
};

/** Who is sending, as the channel services see it. */
export type MetaTextActor =
  | { type: 'user' }
  | {
      type: 'agent';
      agentId: string;
      ownershipVersion: number;
      decisionId: string;
      policyVersion: string;
    }
  | { type: 'automation'; automationId: string }
  | {
      type: 'followup';
      automationId: string | null;
      stepKey: string;
      userId: string | null;
    };

export function isHumanActor(actor: MetaTextActor): boolean {
  return actor.type === 'user' || actor.type === 'followup';
}

/** The event/outbox author for an actor; the automation speaks as the system. */
export function metaActorAuthorType(
  actor: MetaTextActor,
): 'user' | 'agent' | 'system' {
  if (actor.type === 'agent') return 'agent';
  if (actor.type === 'automation') return 'system';
  return 'user';
}

/**
 * What the outbox carries besides the author, for the follow-up machinery: the
 * idle detector must not arm a new cadence from a message that belongs to one,
 * and the consumer recognises its own chain by `automationId`.
 */
export function metaActorOutboxFields(
  actor: MetaTextActor,
): Record<string, string> {
  if (actor.type === 'automation') return { automationId: actor.automationId };
  if (actor.type === 'followup') {
    return {
      followUpStepKey: actor.stepKey,
      ...(actor.automationId ? { automationId: actor.automationId } : {}),
    };
  }
  return {};
}

/** The same, on the message row. */
export function metaActorMessageMetadata(
  actor: MetaTextActor,
  tag: string | null,
): Record<string, unknown> {
  return {
    ...metaActorOutboxFields(actor),
    ...(tag ? { messageTag: tag } : {}),
  };
}

export function assertAutomationSendConfirmed(
  message: InboxMessageEntity,
): void {
  if (!['sent', 'delivered', 'read'].includes(message.status)) {
    // A retry may find a previous pending/failed row with the same effect key.
    // It must never read that uncertain outcome as confirmation and advance
    // the D+N sequence.
    throw new ServiceUnavailableException(
      'Automation message delivery is not confirmed.',
    );
  }
}

/**
 * A person sending a pending follow-up does not take the conversation, but
 * they may not speak over a colleague who did, nor into a closed one.
 */
export function assertFollowUpSendable(
  conversation: InboxConversationEntity,
  actor: Extract<MetaTextActor, { type: 'followup' }>,
) {
  if (
    conversation.ownershipState === 'closed' ||
    ['resolved', 'closed', 'archived'].includes(conversation.status)
  ) {
    throw new ConflictException('Follow-up blocked: conversation is closed.');
  }
  if (
    conversation.ownershipState === 'human_active' &&
    conversation.assignedUserId &&
    conversation.assignedUserId !== actor.userId
  ) {
    throw new ConflictException(
      'Follow-up blocked: another user owns the conversation.',
    );
  }
}
