import { Injectable } from '@nestjs/common';
import { NotificationRecipientStrategy } from '../enums';
import {
  NotificationDefinition,
  NotificationExplicitRecipient,
  NotificationSourceEvent,
} from '../types';

@Injectable()
export class NotificationRecipientResolverService {
  resolve(
    event: NotificationSourceEvent,
    definition: NotificationDefinition,
  ): NotificationExplicitRecipient[] {
    const explicitRecipients = event.recipients ?? [];

    if (
      definition.recipientStrategy ===
      NotificationRecipientStrategy.EXPLICIT_USERS
    ) {
      return explicitRecipients;
    }

    /*
     * Fundação inicial:
     * os módulos ainda devem fornecer os destinatários já resolvidos.
     *
     * Nas próximas integrações, cada estratégia será ligada aos
     * repositories reais de Tasks, Projects, Team, Finance etc.
     */
    return explicitRecipients;
  }
}
