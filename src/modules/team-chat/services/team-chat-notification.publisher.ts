import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { NotificationExplicitRecipient } from '../../notifications/types';
import {
  AgencyChatChannel,
  AgencyChatMessage,
  AgencyMeetingAiSummary,
  AgencyMeetingRoom,
} from '../entities';

type TeamChatRecipientInput = {
  userId?: string | null;
  interestReason: NotificationInterestReason;
};

type TeamChatNotificationInput = {
  tenantId: string;
  workspaceId: string;
  actorUserId?: string | null;
  occurredAt?: Date;
  recipients?: TeamChatRecipientInput[];
};

@Injectable()
export class TeamChatNotificationPublisher {
  private readonly logger = new Logger(TeamChatNotificationPublisher.name);

  constructor(
    private readonly notificationEventProcessor: NotificationEventProcessorService,
  ) {}

  publishDirectMessageReceived(
    input: TeamChatNotificationInput & {
      channel: AgencyChatChannel;
      message: AgencyChatMessage;
      recipientUserId?: string | null;
    },
  ) {
    return this.publishChatEvent({
      ...input,
      eventType: 'chat.direct_message_received',
      eventIdParts: [
        'chat.direct_message_received',
        input.message.id,
        input.recipientUserId,
      ],
      resourceType: 'chat_message',
      resourceId: input.message.id,
      title: 'Nova mensagem direta',
      body: 'Você recebeu uma nova mensagem direta.',
      actionUrl: '/messages',
      recipients:
        input.recipients ??
        [
          {
            userId: input.recipientUserId,
            interestReason: NotificationInterestReason.PARTICIPANT,
          },
        ],
      payload: {
        channelId: input.channel.id,
        messageId: input.message.id,
      },
    });
  }

  publishUserMentioned(
    input: TeamChatNotificationInput & {
      channel: AgencyChatChannel;
      message: AgencyChatMessage;
      mentionedUserIds: Array<string | null | undefined>;
    },
  ) {
    return this.publishChatEvent({
      ...input,
      eventType: 'chat.user_mentioned',
      eventIdParts: [
        'chat.user_mentioned',
        input.message.id,
        this.timestampFor(input.message.createdAt),
      ],
      resourceType: 'chat_message',
      resourceId: input.message.id,
      title: 'Você foi mencionado',
      body: 'Você foi mencionado em uma mensagem.',
      actionUrl: '/messages',
      recipients:
        input.recipients ??
        input.mentionedUserIds.map((userId) => ({
          userId,
          interestReason: NotificationInterestReason.MENTIONED,
        })),
      payload: {
        channelId: input.channel.id,
        messageId: input.message.id,
      },
    });
  }

  publishChannelInvited(
    input: TeamChatNotificationInput & {
      channel: AgencyChatChannel;
      invitedUserId?: string | null;
      memberId?: string | null;
    },
  ) {
    return this.publishChatEvent({
      ...input,
      eventType: 'chat.channel_invitation_received',
      eventIdParts: [
        'chat.channel_invitation_received',
        input.channel.id,
        input.invitedUserId,
        input.memberId,
      ],
      resourceType: 'chat_channel',
      resourceId: input.channel.id,
      title: 'Convite para canal',
      body: `Você foi adicionado ao canal "${input.channel.name}".`,
      actionUrl: '/messages',
      recipients:
        input.recipients ??
        [
          {
            userId: input.invitedUserId,
            interestReason: NotificationInterestReason.PARTICIPANT,
          },
        ],
      payload: {
        channelId: input.channel.id,
      },
    });
  }

  publishCallMissed(input: TeamChatNotificationInput & { meeting: AgencyMeetingRoom }) {
    return this.publishPreparedMeetingEvent(input, 'chat.call_missed');
  }

  publishMeetingStarted(
    input: TeamChatNotificationInput & {
      meeting: AgencyMeetingRoom;
      eventId?: string | null;
    },
  ) {
    return this.publishChatEvent({
      ...input,
      eventType: 'chat.call_started',
      eventIdParts: [
        'chat.call_started',
        input.meeting.id,
        input.eventId,
        this.timestampFor(input.meeting.startedAt ?? input.occurredAt),
      ],
      resourceType: 'meeting_room',
      resourceId: input.meeting.id,
      title: 'Reunião iniciada',
      body: `A reunião "${input.meeting.title}" começou.`,
      actionUrl: '/messages',
      recipients: input.recipients ?? [],
      payload: {
        meetingId: input.meeting.id,
      },
    });
  }

  publishRecordingReady(input: TeamChatNotificationInput & { meeting: AgencyMeetingRoom }) {
    return this.publishPreparedMeetingEvent(input, 'chat.recording_ready');
  }

  publishSummaryReady(
    input: TeamChatNotificationInput & {
      meeting: AgencyMeetingRoom;
      summary: AgencyMeetingAiSummary;
    },
  ) {
    return this.publishChatEvent({
      ...input,
      eventType: 'chat.summary_ready',
      eventIdParts: [
        'chat.summary_ready',
        input.meeting.id,
        input.summary.id,
        this.timestampFor(input.summary.completedAt ?? input.summary.updatedAt),
      ],
      resourceType: 'meeting_ai_summary',
      resourceId: input.summary.id,
      title: 'Resumo da reunião pronto',
      body: 'O resumo da reunião está pronto.',
      actionUrl: '/messages',
      recipients:
        input.recipients ??
        [
          {
            userId: input.summary.requestedById,
            interestReason: NotificationInterestReason.REQUESTER,
          },
        ],
      payload: {
        meetingId: input.meeting.id,
        summaryId: input.summary.id,
      },
    });
  }

  publishTranscriptionReady(input: TeamChatNotificationInput & { meeting: AgencyMeetingRoom }) {
    return this.publishPreparedMeetingEvent(input, 'chat.transcription_ready');
  }

  publishMessageFailed(input: TeamChatNotificationInput & { message: AgencyChatMessage }) {
    return this.publishPreparedMessageEvent(input, 'chat.message_failed');
  }

  publishIntegrationFailed(input: TeamChatNotificationInput & { meeting: AgencyMeetingRoom }) {
    return this.publishPreparedMeetingEvent(input, 'chat.integration_failed');
  }

  publishAiSummaryFailed(input: TeamChatNotificationInput & { meeting: AgencyMeetingRoom }) {
    return this.publishPreparedMeetingEvent(input, 'chat.ai_summary_failed');
  }

  private publishPreparedMessageEvent(
    input: TeamChatNotificationInput & { message: AgencyChatMessage },
    eventType: string,
  ) {
    return this.publishChatEvent({
      ...input,
      eventType,
      eventIdParts: [eventType, input.message.id],
      resourceType: 'chat_message',
      resourceId: input.message.id,
      title: 'Mensagem requer atenção',
      body: 'Uma mensagem requer atenção.',
      actionUrl: '/messages',
      recipients: input.recipients ?? [],
      payload: {
        messageId: input.message.id,
      },
    });
  }

  private publishPreparedMeetingEvent(
    input: TeamChatNotificationInput & { meeting: AgencyMeetingRoom },
    eventType: string,
  ) {
    return this.publishChatEvent({
      ...input,
      eventType,
      eventIdParts: [eventType, input.meeting.id],
      resourceType: 'meeting_room',
      resourceId: input.meeting.id,
      title: 'Reunião requer atenção',
      body: 'Uma reunião requer atenção.',
      actionUrl: '/messages',
      recipients: input.recipients ?? [],
      payload: {
        meetingId: input.meeting.id,
      },
    });
  }

  private async publishChatEvent(
    input: TeamChatNotificationInput & {
      eventType: string;
      eventIdParts: Array<string | null | undefined>;
      resourceType: string;
      resourceId: string | null;
      title: string;
      body: string;
      actionUrl: string | null;
      recipients: TeamChatRecipientInput[];
      payload?: Record<string, unknown>;
    },
  ) {
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
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'team-chat',
        actorType: NotificationActorType.USER,
        actorUserId: input.actorUserId ?? null,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        recipients,
        payload: {
          title: input.title,
          body: input.body,
          actionUrl: input.actionUrl,
          resourceId: input.resourceId,
          ...input.payload,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish ${input.eventType} for team-chat resource ${input.resourceId} tenant ${input.tenantId} workspace ${input.workspaceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private normalizeRecipients(
    recipients: TeamChatRecipientInput[],
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

  private timestampFor(value?: Date | string | null) {
    if (!value) {
      return new Date().toISOString();
    }

    return value instanceof Date ? value.toISOString() : value;
  }
}
