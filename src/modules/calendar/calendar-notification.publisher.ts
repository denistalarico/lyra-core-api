import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../notifications/enums';
import { NotificationEventProcessorService } from '../notifications/services';
import { NotificationExplicitRecipient } from '../notifications/types';
import { CalendarEvent } from './entities/calendar-event.entity';

type CalendarNotificationInput = {
  event: CalendarEvent;
  actorUserId?: string | null;
  actorName?: string | null;
  occurredAt?: Date;
};

type CalendarRecipientInput = {
  userId?: string | null;
  interestReason: NotificationInterestReason;
};

@Injectable()
export class CalendarNotificationPublisher {
  private readonly logger = new Logger(CalendarNotificationPublisher.name);

  constructor(
    private readonly notificationEventProcessor: NotificationEventProcessorService,
  ) {}

  publishInvitationReceived(
    input: CalendarNotificationInput & {
      participantUserIds: Array<string | null | undefined>;
    },
  ) {
    return this.publishCalendarEvent({
      ...input,
      eventType: 'calendar.event_invitation_received',
      eventIdParts: [
        'calendar.event_invitation_received',
        input.event.id,
        input.participantUserIds.filter(Boolean).join(',') || 'none',
        this.timestampFor(input.event.updatedAt),
      ],
      recipients: input.participantUserIds.map((userId) => ({
        userId,
        interestReason: NotificationInterestReason.PARTICIPANT,
      })),
      title: 'Convite para evento',
      body: `Você foi convidado para "${input.event.title}".`,
    });
  }

  publishEventUpdated(
    input: CalendarNotificationInput & {
      recipientUserIds: Array<string | null | undefined>;
    },
  ) {
    return this.publishCalendarEvent({
      ...input,
      eventType: 'calendar.event_updated',
      eventIdParts: [
        'calendar.event_updated',
        input.event.id,
        this.timestampFor(input.event.updatedAt),
      ],
      recipients: input.recipientUserIds.map((userId) => ({
        userId,
        interestReason: NotificationInterestReason.OWNER,
      })),
      title: 'Evento atualizado',
      body: `O evento "${input.event.title}" foi atualizado.`,
    });
  }

  publishEventCanceled(
    input: CalendarNotificationInput & {
      recipientUserIds: Array<string | null | undefined>;
    },
  ) {
    return this.publishCalendarEvent({
      ...input,
      eventType: 'calendar.event_canceled',
      eventIdParts: [
        'calendar.event_canceled',
        input.event.id,
        this.timestampFor(input.event.updatedAt),
      ],
      recipients: input.recipientUserIds.map((userId) => ({
        userId,
        interestReason: NotificationInterestReason.OWNER,
      })),
      title: 'Evento cancelado',
      body: `O evento "${input.event.title}" foi cancelado.`,
    });
  }

  publishEventRescheduled(
    input: CalendarNotificationInput & {
      recipientUserIds: Array<string | null | undefined>;
    },
  ) {
    return this.publishCalendarEvent({
      ...input,
      eventType: 'calendar.event_rescheduled',
      eventIdParts: [
        'calendar.event_rescheduled',
        input.event.id,
        this.timestampFor(input.event.updatedAt),
      ],
      recipients: input.recipientUserIds.map((userId) => ({
        userId,
        interestReason: NotificationInterestReason.OWNER,
      })),
      title: 'Evento reagendado',
      body: `O evento "${input.event.title}" foi reagendado.`,
    });
  }

  publishAttendeeResponseReceived(
    input: CalendarNotificationInput & {
      attendeeUserId?: string | null;
      attendeeName?: string | null;
      response: string;
      ownerUserId?: string | null;
    },
  ) {
    return this.publishCalendarEvent({
      ...input,
      eventType: 'calendar.attendee_response_received',
      eventIdParts: [
        'calendar.attendee_response_received',
        input.event.id,
        input.attendeeUserId,
        input.response,
        this.timestampFor(input.event.updatedAt),
      ],
      recipients: [
        {
          userId: input.ownerUserId,
          interestReason: NotificationInterestReason.OWNER,
        },
      ],
      title: 'Resposta de participante',
      body: input.attendeeName
        ? `${input.attendeeName} respondeu ao evento "${input.event.title}".`
        : `Um participante respondeu ao evento "${input.event.title}".`,
      payload: {
        attendeeUserId: input.attendeeUserId ?? null,
        response: input.response,
      },
    });
  }

  private async publishCalendarEvent(input: CalendarNotificationInput & {
    eventType: string;
    eventIdParts: Array<string | null | undefined>;
    recipients: CalendarRecipientInput[];
    title: string;
    body: string;
    payload?: Record<string, unknown>;
  }) {
    const recipients = this.normalizeRecipients(
      input.recipients,
      input.actorUserId,
    );

    if (recipients.length === 0) {
      return;
    }

    try {
      await this.notificationEventProcessor.process({
        eventId: this.buildEventId(input.eventIdParts),
        eventType: input.eventType,
        tenantId: input.event.tenantId,
        workspaceId: input.event.workspaceId ?? null,
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'calendar',
        actorType: NotificationActorType.USER,
        actorUserId: input.actorUserId ?? null,
        resourceType: 'calendar_event',
        resourceId: input.event.id,
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        recipients,
        payload: {
          title: input.title,
          body: input.body,
          actionUrl: '/calendar',
          eventId: input.event.id,
          eventTitle: input.event.title,
          startsAt: input.event.startsAt.toISOString(),
          endsAt: input.event.endsAt.toISOString(),
          ownerUserId: input.event.ownerUserId,
          ...input.payload,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish ${input.eventType} for calendar event ${input.event.id} tenant ${input.event.tenantId} workspace ${input.event.workspaceId ?? 'none'}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private normalizeRecipients(
    recipients: CalendarRecipientInput[],
    actorUserId?: string | null,
  ): NotificationExplicitRecipient[] {
    const normalized = new Map<string, NotificationInterestReason>();

    for (const recipient of recipients) {
      const userId = recipient.userId?.trim();

      if (!userId || userId === actorUserId) {
        continue;
      }

      if (!normalized.has(userId)) {
        normalized.set(userId, recipient.interestReason);
      }
    }

    return Array.from(normalized.entries()).map(
      ([userId, interestReason]) => ({
        userId,
        interestReason,
      }),
    );
  }

  private buildEventId(parts: Array<string | null | undefined>) {
    return parts.map((part) => part ?? 'none').join(':');
  }

  private timestampFor(value?: Date | null) {
    return (value ?? new Date()).toISOString();
  }
}
