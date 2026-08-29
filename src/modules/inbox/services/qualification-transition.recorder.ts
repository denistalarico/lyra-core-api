import type { EntityManager } from 'typeorm';
import { InboxConversationEventEntity } from '../entities/inbox-conversation-event.entity';
import type { InboxConversationEntity } from '../entities/inbox-conversation.entity';

/**
 * The historical record of qualification changes.
 *
 * `inbox_conversations.qualification_status` answers "is this conversation
 * qualified now?" and keeps answering it — this file does not change that, and
 * nothing here reads that column to decide anything. What the column cannot
 * answer is "how many conversations became qualified in July", because a column
 * holding the current value has no memory of when it started holding it. The
 * cross-domain funnel needed that question answered and had to return null for
 * every metric that depended on it.
 *
 * The evidence therefore goes where this domain already keeps evidence:
 * `inbox_conversation_events`, append-only, written in the caller's transaction.
 * No new table — see the module notes below for why the alternatives lost.
 *
 * Direction of dependency: this file produces the fact. The LeadFlow
 * Intelligence adapter will read it later. Nothing in Intelligence is imported
 * here, and nothing here knows Intelligence exists.
 */

/** The event type appended for every observed qualification change. */
export const QUALIFICATION_STATUS_CHANGED_EVENT =
  'qualification_status_changed';

/**
 * The four values `qualification_status` actually holds.
 *
 * Mirrors the entity's union rather than importing a shared enum, because there
 * is no shared enum: the column is a `varchar(32)` with a `'pending'` default,
 * and this is the complete set of values the four writers assign.
 */
export type QualificationStatus =
  | 'pending'
  | 'qualified'
  | 'disqualified'
  | 'internal';

/**
 * Who caused a transition, in the vocabulary `actor_type` already uses.
 *
 * `system` is the honest answer for an automatic decision with no human or
 * agent behind it — inbound rule evaluation, for example. It is not a
 * placeholder for "we didn't bother to find out": each call site passes what it
 * actually knows, and the three that know nothing more say `system` because
 * that is the truth about them.
 */
export type QualificationActor =
  | { type: 'user'; userId: string | null }
  | { type: 'agent'; agentId: string | null }
  | { type: 'system' };

export type QualificationTransitionInput = {
  conversation: Pick<
    InboxConversationEntity,
    'id' | 'tenantId' | 'workspaceId'
  >;
  previousStatus: QualificationStatus;
  newStatus: QualificationStatus;
  /** The `qualification_reason` written alongside the status, when there is one. */
  reason: string | null;
  actor: QualificationActor;
  /** When the change happened. Callers with a provider timestamp pass it. */
  occurredAt: Date;
};

/**
 * Appends one transition, or nothing at all when the status did not change.
 *
 * The no-op guard lives here rather than in each caller so it cannot be
 * forgotten by one of them. A writer that re-asserts `qualified` on an already
 * qualified conversation has observed nothing, and a row claiming
 * `qualified → qualified` would later be counted as a second qualification by
 * any query naive enough to trust it.
 *
 * Returns the appended event, or `null` for the no-op, so callers and tests can
 * tell the two apart.
 */
export async function recordQualificationTransition(
  manager: EntityManager,
  input: QualificationTransitionInput,
): Promise<InboxConversationEventEntity | null> {
  if (input.previousStatus === input.newStatus) return null;

  const events = manager.getRepository(InboxConversationEventEntity);

  return events.save(
    events.create({
      tenantId: input.conversation.tenantId,
      workspaceId: input.conversation.workspaceId,
      conversationId: input.conversation.id,
      eventType: QUALIFICATION_STATUS_CHANGED_EVENT,
      actorType: input.actor.type,
      actorUserId: input.actor.type === 'user' ? input.actor.userId : null,
      // Only the transition and its operational provenance. No message text, no
      // contact identity, no agent reasoning — a lead's phone number is not
      // needed to count qualifications, and analytics reads this table.
      payload: {
        previousStatus: input.previousStatus,
        newStatus: input.newStatus,
        reason: input.reason,
        occurredAt: input.occurredAt.toISOString(),
        ...(input.actor.type === 'agent'
          ? { actorAgentId: input.actor.agentId }
          : {}),
      },
    }),
  );
}
