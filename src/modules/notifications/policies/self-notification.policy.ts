import { Injectable } from '@nestjs/common';
import { NotificationSelfPolicy } from '../enums';
import {
  NotificationExplicitRecipient,
  NotificationSourceEvent,
} from '../types';

@Injectable()
export class SelfNotificationPolicy {
  apply(
    event: NotificationSourceEvent,
    recipients: NotificationExplicitRecipient[],
    policy: NotificationSelfPolicy,
  ): NotificationExplicitRecipient[] {
    if (policy === NotificationSelfPolicy.ALLOW_ACTOR) {
      return this.uniqueRecipients(recipients);
    }

    if (policy === NotificationSelfPolicy.ACTOR_ONLY) {
      const targetUserId =
        event.initiatedByUserId ?? event.actorUserId ?? null;

      if (!targetUserId) {
        return [];
      }

      return this.uniqueRecipients(
        recipients.filter(
          (recipient) => recipient.userId === targetUserId,
        ),
      );
    }

    if (!event.actorUserId) {
      return this.uniqueRecipients(recipients);
    }

    return this.uniqueRecipients(
      recipients.filter(
        (recipient) => recipient.userId !== event.actorUserId,
      ),
    );
  }

  private uniqueRecipients(
    recipients: NotificationExplicitRecipient[],
  ): NotificationExplicitRecipient[] {
    const unique = new Map<
      string,
      NotificationExplicitRecipient
    >();

    for (const recipient of recipients) {
      if (!unique.has(recipient.userId)) {
        unique.set(recipient.userId, recipient);
      }
    }

    return Array.from(unique.values());
  }
}
