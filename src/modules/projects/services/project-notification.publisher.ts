import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { NotificationExplicitRecipient } from '../../notifications/types';
import { AgencyProject } from '../entities';

type ProjectNotificationInput = {
  project: AgencyProject;
  actorUserId?: string | null;
  occurredAt?: Date;
};

type ProjectRecipientInput = {
  userId?: string | null;
  interestReason: NotificationInterestReason;
};

@Injectable()
export class ProjectNotificationPublisher {
  private readonly logger = new Logger(ProjectNotificationPublisher.name);

  constructor(
    private readonly notificationEventProcessor: NotificationEventProcessorService,
  ) {}

  publishDeadlineAtRisk(
    input: ProjectNotificationInput & { phase: 'due_soon' | 'overdue' },
  ) {
    const isOverdue = input.phase === 'overdue';

    return this.publishProjectEvent({
      ...input,
      eventType: 'project.deadline_at_risk',
      eventIdParts: [
        'project.deadline_at_risk',
        input.phase,
        input.project.id,
        this.timestampFor(input.project.dueDate),
      ],
      recipients: [
        {
          userId: input.project.ownerId,
          interestReason: NotificationInterestReason.OWNER,
        },
      ],
      title: isOverdue
        ? 'Projeto com prazo vencido'
        : 'Prazo do projeto se aproximando',
      body: isOverdue
        ? `O projeto "${input.project.name}" está com o prazo vencido.`
        : `O projeto "${input.project.name}" está próximo do prazo final.`,
    });
  }

  private async publishProjectEvent(
    input: ProjectNotificationInput & {
      eventType: string;
      eventIdParts: Array<string | null | undefined>;
      recipients: ProjectRecipientInput[];
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
        tenantId: input.project.tenantId,
        workspaceId: input.project.workspaceId,
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'projects',
        actorType: NotificationActorType.USER,
        actorUserId: input.actorUserId ?? null,
        resourceType: 'project',
        resourceId: input.project.id,
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        recipients,
        payload: {
          title: input.title,
          body: input.body,
          actionUrl: `/projects/${input.project.id}`,
          projectId: input.project.id,
          projectName: input.project.name,
          ownerId: input.project.ownerId,
          status: input.project.status,
          dueDate: input.project.dueDate?.toISOString() ?? null,
          ...input.payload,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish ${input.eventType} for project ${input.project.id} tenant ${input.project.tenantId} workspace ${input.project.workspaceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private normalizeRecipients(
    recipients: ProjectRecipientInput[],
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
