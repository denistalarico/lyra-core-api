import { Injectable } from '@nestjs/common';
import type { ClientAreaContext } from '../client-area/client-area.types';
import type { PermissionContext } from '../permissions/types/permission-context.types';
import type { ClientConversationMessageMetadata } from './client-conversation.types';
import type { ClientConversationScope } from './services/client-conversation-access';
import type { ConversationMessageView } from './services/client-conversations.service';

/**
 * OR7 — the seam through which a sent message reaches the Orion.
 *
 * Same shape and same reason as `client-conversation-approvals.port.ts`: the
 * conversations domain declares what it needs, provides the registry itself,
 * and `ClientConversationOrionModule` (which imports both sides) fills it.
 * Importing the Orion here would pull its whole graph (LeadFlow agents, Team
 * Chat) into every consumer of this module. With the join module absent, a
 * mention is stored and nothing answers — degradation, not breakage.
 */

/** Who mentioned the Orion, as the send route proved them. */
export type ClientConversationMentionAuthor =
  | { surface: 'client_area'; context: ClientAreaContext }
  | {
      surface: 'agency';
      user: PermissionContext & { workspaceId: string };
    };

export type ClientConversationMention = {
  author: ClientConversationMentionAuthor;
  scope: ClientConversationScope;
  message: ConversationMessageView;
};

const MENTION = /(^|\s)@orion(?=$|[\s,.:;!?])/i;

export function hasVisibleOrionMention(body: unknown): body is string {
  return typeof body === 'string' && MENTION.test(body);
}

/**
 * The metadata a send stores for an `@Orion` mention: only when the composer
 * marked it and the body shows it, so neither alone triggers a turn.
 */
export function orionMentionMetadata(input: {
  body?: unknown;
  assistantMention?: unknown;
}): ClientConversationMessageMetadata | null {
  return input.assistantMention === 'orion' &&
    hasVisibleOrionMention(input.body)
    ? { assistantMention: 'orion' }
    : null;
}

/** Empty until the join module fills it; `schedule` never throws. */
@Injectable()
export class ClientConversationAssistantRegistry {
  private handler: ((mention: ClientConversationMention) => void) | null = null;

  register(handler: (mention: ClientConversationMention) => void): void {
    this.handler = handler;
  }

  schedule(mention: ClientConversationMention): void {
    this.handler?.(mention);
  }
}
