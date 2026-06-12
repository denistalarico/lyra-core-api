import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { NotificationExplicitRecipient } from '../../notifications/types';
import { AgencyTask } from '../entities';

type TaskNotificationInput = {
  task: AgencyTask;
  actorUserId?: string | null;
  actorName?: string | null;
  occurredAt?: Date;
};

type TaskRecipientInput = {
  userId?: string | null;
  interestReason: NotificationInterestReason;
};

@Injectable()
export class TaskNotificationPublisher {
  private readonly logger = new Logger(TaskNotificationPublisher.name);

  constructor(
    private readonly notificationEventProcessor: NotificationEventProcessorService,
  ) {}

  publishAssigned(input: TaskNotificationInput) {
    const assigneeId = input.task.assigneeId;

    return this.publishTaskEvent({
      ...input,
      eventType: 'task.assigned',
      eventIdParts: [
        'task.assigned',
        input.task.id,
        assigneeId,
        this.timestampFor(input.task.updatedAt),
      ],
      recipients: [
        {
          userId: assigneeId,
          interestReason: NotificationInterestReason.ASSIGNED,
        },
      ],
      title: 'Nova tarefa atribuída',
      body: input.actorName
        ? `${input.actorName} atribuiu a tarefa "${input.task.title}" a você.`
        : `Uma tarefa foi atribuída a você: "${input.task.title}".`,
    });
  }

  publishReassigned(
    input: TaskNotificationInput & { previousAssigneeId?: string | null },
  ) {
    const assigneeId = input.task.assigneeId;

    return this.publishTaskEvent({
      ...input,
      eventType: 'task.reassigned',
      eventIdParts: [
        'task.reassigned',
        input.task.id,
        input.previousAssigneeId,
        assigneeId,
        this.timestampFor(input.task.updatedAt),
      ],
      recipients: [
        {
          userId: assigneeId,
          interestReason: NotificationInterestReason.ASSIGNED,
        },
      ],
      title: 'Tarefa reatribuída',
      body: `A tarefa "${input.task.title}" foi reatribuída a você.`,
    });
  }

  publishMentioned(
    input: TaskNotificationInput & {
      mentionedUserIds: Array<string | null | undefined>;
      commentId?: string | null;
    },
  ) {
    return this.publishTaskEvent({
      ...input,
      eventType: 'task.user_mentioned',
      eventIdParts: [
        'task.user_mentioned',
        input.task.id,
        input.commentId,
        this.timestampFor(input.occurredAt ?? input.task.updatedAt),
      ],
      recipients: input.mentionedUserIds.map((userId) => ({
        userId,
        interestReason: NotificationInterestReason.MENTIONED,
      })),
      title: 'Você foi mencionado',
      body: `Você foi mencionado na tarefa "${input.task.title}".`,
      payload: {
        commentId: input.commentId ?? null,
      },
    });
  }

  publishCompleted(input: TaskNotificationInput) {
    return this.publishTaskEvent({
      ...input,
      eventType: 'task.completed',
      eventIdParts: [
        'task.completed',
        input.task.id,
        this.timestampFor(input.task.completedAt ?? input.task.updatedAt),
      ],
      recipients: [
        {
          userId: input.task.createdById,
          interestReason: NotificationInterestReason.OWNER,
        },
      ],
      title: 'Tarefa concluída',
      body: `A tarefa "${input.task.title}" foi concluída.`,
    });
  }

  publishReopened(input: TaskNotificationInput) {
    return this.publishTaskEvent({
      ...input,
      eventType: 'task.reopened',
      eventIdParts: [
        'task.reopened',
        input.task.id,
        this.timestampFor(input.task.updatedAt),
      ],
      recipients: [
        {
          userId: input.task.assigneeId,
          interestReason: NotificationInterestReason.ASSIGNED,
        },
      ],
      title: 'Tarefa reaberta',
      body: `A tarefa "${input.task.title}" foi reaberta.`,
    });
  }

  publishBlocked(
    input: TaskNotificationInput & { projectOwnerId?: string | null },
  ) {
    return this.publishTaskEvent({
      ...input,
      eventType: 'task.blocked',
      eventIdParts: [
        'task.blocked',
        input.task.id,
        this.timestampFor(input.task.updatedAt),
      ],
      recipients: [
        {
          userId: input.task.createdById,
          interestReason: NotificationInterestReason.OWNER,
        },
        {
          userId: input.projectOwnerId,
          interestReason: NotificationInterestReason.OWNER,
        },
      ],
      title: 'Tarefa bloqueada',
      body: `A tarefa "${input.task.title}" foi bloqueada.`,
    });
  }

  publishUnblocked(
    input: TaskNotificationInput & { projectOwnerId?: string | null },
  ) {
    return this.publishTaskEvent({
      ...input,
      eventType: 'task.unblocked',
      eventIdParts: [
        'task.unblocked',
        input.task.id,
        this.timestampFor(input.task.updatedAt),
      ],
      recipients: [
        {
          userId: input.task.createdById,
          interestReason: NotificationInterestReason.OWNER,
        },
        {
          userId: input.projectOwnerId,
          interestReason: NotificationInterestReason.OWNER,
        },
      ],
      title: 'Tarefa desbloqueada',
      body: `A tarefa "${input.task.title}" foi desbloqueada.`,
    });
  }

  publishApprovalRequested(
    input: TaskNotificationInput & {
      approverUserIds: Array<string | null | undefined>;
    },
  ) {
    return this.publishTaskEvent({
      ...input,
      eventType: 'task.approval_requested',
      eventIdParts: [
        'task.approval_requested',
        input.task.id,
        this.timestampFor(input.task.updatedAt),
      ],
      recipients: input.approverUserIds.map((userId) => ({
        userId,
        interestReason: NotificationInterestReason.APPROVER,
      })),
      title: 'Aprovação solicitada',
      body: `A tarefa "${input.task.title}" precisa de aprovação.`,
    });
  }

  publishApprovalResolved(
    input: TaskNotificationInput & {
      requesterUserId?: string | null;
      approved?: boolean | null;
    },
  ) {
    return this.publishTaskEvent({
      ...input,
      eventType: 'task.approval_resolved',
      eventIdParts: [
        'task.approval_resolved',
        input.task.id,
        input.approved === false ? 'rejected' : 'resolved',
        this.timestampFor(input.task.updatedAt),
      ],
      recipients: [
        {
          userId: input.requesterUserId,
          interestReason: NotificationInterestReason.REQUESTER,
        },
      ],
      title: 'Aprovação resolvida',
      body: `A aprovação da tarefa "${input.task.title}" foi resolvida.`,
    });
  }

  private async publishTaskEvent(input: TaskNotificationInput & {
    eventType: string;
    eventIdParts: Array<string | null | undefined>;
    recipients: TaskRecipientInput[];
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
        tenantId: input.task.tenantId,
        workspaceId: input.task.workspaceId,
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'tasks',
        actorType: NotificationActorType.USER,
        actorUserId: input.actorUserId ?? null,
        resourceType: 'task',
        resourceId: input.task.id,
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        recipients,
        payload: {
          title: input.title,
          body: input.body,
          actionUrl: this.resolveActionUrl(input.task),
          taskId: input.task.id,
          taskTitle: input.task.title,
          projectId: input.task.projectId,
          assigneeId: input.task.assigneeId,
          status: input.task.status,
          dueDate: input.task.dueDate?.toISOString() ?? null,
          ...input.payload,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish ${input.eventType} for task ${input.task.id} tenant ${input.task.tenantId} workspace ${input.task.workspaceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private normalizeRecipients(
    recipients: TaskRecipientInput[],
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

  private resolveActionUrl(task: AgencyTask) {
    if (task.projectId) {
      return `/projects/${task.projectId}/tasks/${task.id}`;
    }

    return `/projects/tasks/${task.id}`;
  }

  private buildEventId(parts: Array<string | null | undefined>) {
    return parts.map((part) => part ?? 'none').join(':');
  }

  private timestampFor(value?: Date | null) {
    return (value ?? new Date()).toISOString();
  }
}
