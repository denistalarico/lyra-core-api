import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  ClientAreaContext,
  ClientAreaModuleLevels,
} from './client-area.types';

export type ClientAreaSettingsRequest =
  | {
      kind: 'invitation_request';
      displayName: string;
      email: string;
      moduleLevels: ClientAreaModuleLevels;
    }
  | { kind: 'deletion_request'; reason: string };

type Publisher = (
  context: ClientAreaContext,
  input: ClientAreaSettingsRequest,
) => Promise<{ requestId: string; conversationId: string }>;

/** Owned by the consumer. Conversations registers the canonical write at init. */
@Injectable()
export class ClientAreaSettingsRequestsRegistry {
  private publisher?: Publisher;
  register(publisher: Publisher) {
    if (this.publisher)
      throw new Error('Settings request publisher already registered.');
    this.publisher = publisher;
  }
  publish(context: ClientAreaContext, input: ClientAreaSettingsRequest) {
    if (!this.publisher)
      throw new ServiceUnavailableException(
        'Settings requests are unavailable.',
      );
    return this.publisher(context, input);
  }
}
