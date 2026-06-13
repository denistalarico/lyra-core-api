import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { NotificationExplicitRecipient } from '../../notifications/types';
import { AgencyKnowledgeArticle, AgencyKnowledgeComment } from '../entities';

type KnowledgeRecipientInput = {
  userId?: string | null;
  interestReason: NotificationInterestReason;
};

type KnowledgeNotificationInput = {
  article: AgencyKnowledgeArticle;
  actorUserId?: string | null;
  occurredAt?: Date;
  recipients?: KnowledgeRecipientInput[];
  eventIdSuffix?: string | null;
};

@Injectable()
export class KnowledgeNotificationPublisher {
  private readonly logger = new Logger(KnowledgeNotificationPublisher.name);

  constructor(
    private readonly notificationEventProcessor: NotificationEventProcessorService,
  ) {}

  publishArticleAssigned(input: KnowledgeNotificationInput) {
    return this.publishKnowledgeEvent({
      ...input,
      eventType: 'knowledge.article_assigned_for_review',
      eventIdParts: [
        'knowledge.article_assigned_for_review',
        input.article.id,
        input.article.ownerId,
        this.timestampFor(input.occurredAt ?? input.article.updatedAt),
      ],
      title: 'Artigo atribuído para revisão',
      body: `O artigo "${input.article.title}" foi atribuído a você.`,
      recipients:
        input.recipients ??
        [
          {
            userId: input.article.ownerId,
            interestReason: NotificationInterestReason.APPROVER,
          },
        ],
    });
  }

  publishArticlePublished(input: KnowledgeNotificationInput) {
    return this.publishKnowledgeEvent({
      ...input,
      eventType: 'knowledge.article_published',
      eventIdParts: [
        'knowledge.article_published',
        input.article.id,
        this.timestampFor(input.article.publishedAt ?? input.occurredAt),
      ],
      title: 'Artigo publicado',
      body: `O artigo "${input.article.title}" foi publicado.`,
      recipients:
        input.recipients ??
        this.articleStakeholders(input.article, NotificationInterestReason.OWNER),
    });
  }

  publishArticleArchived(input: KnowledgeNotificationInput) {
    return this.publishKnowledgeEvent({
      ...input,
      eventType: 'knowledge.article_archived',
      eventIdParts: [
        'knowledge.article_archived',
        input.article.id,
        this.timestampFor(input.article.archivedAt ?? input.occurredAt),
      ],
      title: 'Artigo arquivado',
      body: `O artigo "${input.article.title}" foi arquivado.`,
      recipients:
        input.recipients ??
        this.articleStakeholders(input.article, NotificationInterestReason.OWNER),
    });
  }

  publishCommentAdded(
    input: KnowledgeNotificationInput & {
      comment: AgencyKnowledgeComment;
    },
  ) {
    return this.publishKnowledgeEvent({
      ...input,
      eventType: 'knowledge.comment_added',
      eventIdParts: [
        'knowledge.comment_added',
        input.article.id,
        input.comment.id,
        this.timestampFor(input.comment.createdAt),
      ],
      title: 'Novo comentário no artigo',
      body: `Um comentário foi adicionado ao artigo "${input.article.title}".`,
      recipients:
        input.recipients ??
        this.articleStakeholders(input.article, NotificationInterestReason.WATCHING),
      payload: {
        commentId: input.comment.id,
      },
    });
  }

  publishUserMentioned(
    input: KnowledgeNotificationInput & {
      commentId?: string | null;
      mentionedUserIds: Array<string | null | undefined>;
    },
  ) {
    return this.publishKnowledgeEvent({
      ...input,
      eventType: 'knowledge.user_mentioned',
      eventIdParts: [
        'knowledge.user_mentioned',
        input.article.id,
        input.commentId,
        this.timestampFor(input.occurredAt ?? input.article.updatedAt),
      ],
      title: 'Você foi mencionado',
      body: `Você foi mencionado no artigo "${input.article.title}".`,
      recipients:
        input.recipients ??
        input.mentionedUserIds.map((userId) => ({
          userId,
          interestReason: NotificationInterestReason.MENTIONED,
        })),
      payload: {
        commentId: input.commentId ?? null,
      },
    });
  }

  publishReviewRequested(input: KnowledgeNotificationInput) {
    return this.publishArticleAssigned(input);
  }

  publishReviewApproved(input: KnowledgeNotificationInput) {
    return this.publishPreparedArticleEvent(input, 'knowledge.review_approved');
  }

  publishReviewRejected(input: KnowledgeNotificationInput) {
    return this.publishPreparedArticleEvent(input, 'knowledge.review_rejected');
  }

  publishArticleExpiring(input: KnowledgeNotificationInput) {
    return this.publishPreparedArticleEvent(input, 'knowledge.article_expiring');
  }

  publishArticleNeedsReview(input: KnowledgeNotificationInput) {
    return this.publishPreparedArticleEvent(
      input,
      'knowledge.article_requires_update',
    );
  }

  publishOnboardingContentAssigned(input: KnowledgeNotificationInput) {
    return this.publishPreparedArticleEvent(
      input,
      'knowledge.onboarding_content_assigned',
    );
  }

  private publishPreparedArticleEvent(
    input: KnowledgeNotificationInput,
    eventType: string,
  ) {
    return this.publishKnowledgeEvent({
      ...input,
      eventType,
      eventIdParts: [eventType, input.article.id, input.eventIdSuffix],
      title: 'Artigo requer atenção',
      body: `O artigo "${input.article.title}" requer atenção.`,
      recipients: input.recipients ?? [],
    });
  }

  private async publishKnowledgeEvent(
    input: KnowledgeNotificationInput & {
      eventType: string;
      eventIdParts: Array<string | null | undefined>;
      title: string;
      body: string;
      recipients: KnowledgeRecipientInput[];
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
        tenantId: input.article.tenantId,
        workspaceId: input.article.workspaceId,
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'knowledge',
        actorType: NotificationActorType.USER,
        actorUserId: input.actorUserId ?? null,
        resourceType: 'knowledge_article',
        resourceId: input.article.id,
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        recipients,
        payload: {
          title: input.title,
          body: input.body,
          actionUrl: `/knowledge/${input.article.id}`,
          articleId: input.article.id,
          ...input.payload,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish ${input.eventType} for knowledge article ${input.article.id} tenant ${input.article.tenantId} workspace ${input.article.workspaceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private articleStakeholders(
    article: AgencyKnowledgeArticle,
    interestReason: NotificationInterestReason,
  ): KnowledgeRecipientInput[] {
    return [
      {
        userId: article.authorId,
        interestReason,
      },
      {
        userId: article.ownerId,
        interestReason,
      },
    ];
  }

  private normalizeRecipients(
    recipients: KnowledgeRecipientInput[],
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
