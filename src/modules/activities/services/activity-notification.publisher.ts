import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { NotificationExplicitRecipient } from '../../notifications/types';
import { AgencyActivity, AgencyActivityLink } from '../entities';
import { ActivityEntityType } from '../enums';

type ActivityRecipientInput = {
  userId?: string | null;
  interestReason: NotificationInterestReason;
};

type ActivityNotificationInput = {
  activity: AgencyActivity;
  links?: AgencyActivityLink[];
  actorUserId?: string | null;
  occurredAt?: Date;
  recipients?: ActivityRecipientInput[];
};

const PROJECT_ENTITY_TYPES = new Set<ActivityEntityType>([
  ActivityEntityType.Project,
  ActivityEntityType.Task,
]);

const SALES_ENTITY_TYPES = new Set<ActivityEntityType>([
  ActivityEntityType.CrmOpportunity,
  ActivityEntityType.SalesOpportunity,
  ActivityEntityType.SalesQuote,
  ActivityEntityType.Contact,
]);

@Injectable()
export class ActivityNotificationPublisher {
  private readonly logger = new Logger(ActivityNotificationPublisher.name);

  constructor(
    private readonly notificationEventProcessor: NotificationEventProcessorService,
  ) {}

  publishAssigned(input: ActivityNotificationInput) {
    const assigneeId = input.activity.assignedToId;

    return this.publishActivityEvent({
      ...input,
      eventType: 'activity.assigned',
      eventIdParts: [
        'activity.assigned',
        input.activity.id,
        assigneeId,
        this.timestampFor(input.occurredAt ?? input.activity.updatedAt),
      ],
      recipients: input.recipients ?? [
        {
          userId: assigneeId,
          interestReason: NotificationInterestReason.ASSIGNED,
        },
      ],
      title: 'Nova atividade atribuída',
      body: `A atividade "${input.activity.summary}" foi atribuída a você.`,
    });
  }

  publishReassigned(
    input: ActivityNotificationInput & { previousAssignedToId?: string | null },
  ) {
    const assigneeId = input.activity.assignedToId;

    return this.publishActivityEvent({
      ...input,
      eventType: 'activity.reassigned',
      eventIdParts: [
        'activity.reassigned',
        input.activity.id,
        input.previousAssignedToId,
        assigneeId,
        this.timestampFor(input.occurredAt ?? input.activity.updatedAt),
      ],
      recipients: input.recipients ?? [
        {
          userId: assigneeId,
          interestReason: NotificationInterestReason.ASSIGNED,
        },
      ],
      title: 'Atividade reatribuída',
      body: `A atividade "${input.activity.summary}" foi reatribuída a você.`,
    });
  }

  publishCompleted(input: ActivityNotificationInput) {
    return this.publishActivityEvent({
      ...input,
      eventType: 'activity.completed',
      eventIdParts: [
        'activity.completed',
        input.activity.id,
        this.timestampFor(input.occurredAt ?? input.activity.completedAt),
      ],
      recipients: input.recipients ?? [
        {
          userId: input.activity.createdById,
          interestReason: NotificationInterestReason.OWNER,
        },
      ],
      title: 'Atividade concluída',
      body: `A atividade "${input.activity.summary}" foi concluída.`,
    });
  }

  publishCanceled(input: ActivityNotificationInput) {
    return this.publishActivityEvent({
      ...input,
      eventType: 'activity.canceled',
      eventIdParts: [
        'activity.canceled',
        input.activity.id,
        this.timestampFor(input.occurredAt ?? input.activity.cancelledAt),
      ],
      recipients: input.recipients ?? [
        {
          userId: input.activity.createdById,
          interestReason: NotificationInterestReason.OWNER,
        },
        {
          userId: input.activity.assignedToId,
          interestReason: NotificationInterestReason.ASSIGNED,
        },
      ],
      title: 'Atividade cancelada',
      body: `A atividade "${input.activity.summary}" foi cancelada.`,
    });
  }

  publishFollowUpCreated(
    input: ActivityNotificationInput & { parentActivityId: string },
  ) {
    const assigneeId = input.activity.assignedToId;

    return this.publishActivityEvent({
      ...input,
      eventType: 'activity.follow_up_created',
      eventIdParts: [
        'activity.follow_up_created',
        input.parentActivityId,
        input.activity.id,
        this.timestampFor(input.occurredAt ?? input.activity.createdAt),
      ],
      recipients: input.recipients ?? [
        {
          userId: assigneeId,
          interestReason: NotificationInterestReason.ASSIGNED,
        },
      ],
      title: 'Atividade de follow-up criada',
      body: `Uma atividade de follow-up "${input.activity.summary}" foi criada para você.`,
      payload: {
        parentActivityId: input.parentActivityId,
      },
    });
  }

  publishMentioned(
    input: ActivityNotificationInput & {
      mentionedUserIds: Array<string | null | undefined>;
      commentId?: string | null;
    },
  ) {
    return this.publishActivityEvent({
      ...input,
      eventType: 'activity.user_mentioned',
      eventIdParts: [
        'activity.user_mentioned',
        input.activity.id,
        input.commentId,
        this.timestampFor(input.occurredAt ?? input.activity.updatedAt),
      ],
      recipients:
        input.recipients ??
        input.mentionedUserIds.map((userId) => ({
          userId,
          interestReason: NotificationInterestReason.MENTIONED,
        })),
      title: 'Você foi mencionado',
      body: `Você foi mencionado na atividade "${input.activity.summary}".`,
      payload: {
        commentId: input.commentId ?? null,
      },
    });
  }

  publishDueSoon(input: ActivityNotificationInput) {
    return this.publishActivityEvent({
      ...input,
      eventType: 'activity.due_soon',
      eventIdParts: [
        'activity.due_soon',
        input.activity.id,
        this.timestampFor(input.activity.dueAt),
      ],
      recipients: input.recipients ?? [
        {
          userId: input.activity.assignedToId,
          interestReason: NotificationInterestReason.ASSIGNED,
        },
      ],
      title: 'Atividade próxima do vencimento',
      body: `A atividade "${input.activity.summary}" está próxima do vencimento.`,
    });
  }

  publishDueToday(input: ActivityNotificationInput) {
    return this.publishActivityEvent({
      ...input,
      eventType: 'activity.due_today',
      eventIdParts: [
        'activity.due_today',
        input.activity.id,
        this.timestampFor(input.activity.dueAt),
      ],
      recipients: input.recipients ?? [
        {
          userId: input.activity.assignedToId,
          interestReason: NotificationInterestReason.ASSIGNED,
        },
      ],
      title: 'Atividade vence hoje',
      body: `A atividade "${input.activity.summary}" vence hoje.`,
    });
  }

  publishReminder(
    input: ActivityNotificationInput & {
      offsetMinutes: number;
      reminderAt: Date;
    },
  ) {
    return this.publishActivityEvent({
      ...input,
      actorUserId: input.actorUserId ?? null,
      eventType: 'activity.reminder',
      eventIdParts: [
        'activity.reminder',
        input.activity.id,
        String(input.offsetMinutes),
        input.reminderAt.toISOString(),
      ],
      recipients: input.recipients ?? [
        {
          userId: input.activity.assignedToId,
          interestReason: NotificationInterestReason.ASSIGNED,
        },
        {
          userId: input.activity.createdById,
          interestReason: NotificationInterestReason.OWNER,
        },
      ],
      title: 'Lembrete de atividade',
      body: `A atividade "${input.activity.summary}" começa em breve.`,
      payload: {
        offsetMinutes: input.offsetMinutes,
        reminderAt: input.reminderAt.toISOString(),
      },
    });
  }

  publishOverdue(input: ActivityNotificationInput) {
    return this.publishActivityEvent({
      ...input,
      eventType: 'activity.overdue',
      eventIdParts: [
        'activity.overdue',
        input.activity.id,
        this.timestampFor(input.activity.dueAt),
      ],
      recipients: input.recipients ?? [
        {
          userId: input.activity.assignedToId,
          interestReason: NotificationInterestReason.ASSIGNED,
        },
      ],
      title: 'Atividade atrasada',
      body: `A atividade "${input.activity.summary}" está atrasada.`,
    });
  }

  private async publishActivityEvent(
    input: ActivityNotificationInput & {
      eventType: string;
      eventIdParts: Array<string | null | undefined>;
      recipients: ActivityRecipientInput[];
      title: string;
      body: string;
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
        tenantId: input.activity.tenantId,
        workspaceId: input.activity.workspaceId,
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'activities',
        actorType: NotificationActorType.USER,
        actorUserId: input.actorUserId ?? null,
        resourceType: 'activity',
        resourceId: input.activity.id,
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        recipients,
        payload: {
          title: input.title,
          body: input.body,
          actionUrl: this.resolveActionUrl(input.links ?? []),
          activityId: input.activity.id,
          activitySummary: input.activity.summary,
          activityType: input.activity.type,
          status: input.activity.status,
          assignedToId: input.activity.assignedToId,
          ...input.payload,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish ${input.eventType} for activity ${input.activity.id} tenant ${input.activity.tenantId} workspace ${input.activity.workspaceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private normalizeRecipients(
    recipients: ActivityRecipientInput[],
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

    return Array.from(normalized.entries()).map(([userId, interestReason]) => ({
      userId,
      interestReason,
    }));
  }

  private resolveActionUrl(links: AgencyActivityLink[]): string | null {
    const clientLink = links.find(
      (link) => link.entityType === ActivityEntityType.Client,
    );

    if (clientLink) {
      return `/clients/${clientLink.entityId}`;
    }

    if (links.some((link) => PROJECT_ENTITY_TYPES.has(link.entityType))) {
      return '/projects/activities';
    }

    if (links.some((link) => SALES_ENTITY_TYPES.has(link.entityType))) {
      return '/sales/activities';
    }

    return null;
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
