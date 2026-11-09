import { Injectable } from '@nestjs/common';
import type { TeamChatContext } from './team-chat-access';

export type TeamChatCardMessage = {
  id: string;
  senderUserId: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * AR5 — how a module adds per-reader data to its cards when they are read.
 *
 * A registry for the reason in `client-conversation-card.port.ts`: Team Chat
 * declares it and knows nothing about who fills it. The returned object is
 * merged into `metadata.card` for that one response and never stored.
 *
 * `metadata` is writable by people through the message routes, so an
 * implementation must only honor messages with a null `senderUserId`, which
 * no person can author.
 */
export type TeamChatCardResolver = {
  resolve(
    context: TeamChatContext,
    messages: readonly TeamChatCardMessage[],
  ): Promise<Map<string, Record<string, unknown>>>;
};

@Injectable()
export class TeamChatCardResolverRegistry {
  private resolver: TeamChatCardResolver | null = null;

  register(resolver: TeamChatCardResolver): void {
    this.resolver = resolver;
  }

  get(): TeamChatCardResolver | null {
    return this.resolver;
  }
}
