import { NotificationInterestReason } from '../../notifications/enums';
import { KnowledgeNotificationPublisher } from './knowledge-notification.publisher';

const processor = {
  process: jest.fn(),
};

const article = {
  id: 'article-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  title: 'Guia de onboarding',
  authorId: 'author-a',
  ownerId: 'owner-a',
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
  updatedAt: new Date('2026-01-01T11:00:00.000Z'),
  publishedAt: null,
  archivedAt: null,
};

describe('KnowledgeNotificationPublisher', () => {
  beforeEach(() => {
    processor.process.mockReset();
  });

  it('publishes article review assignment to the owner', async () => {
    const publisher = new KnowledgeNotificationPublisher(processor as never);

    await publisher.publishArticleAssigned({
      article: article as never,
      actorUserId: 'author-a',
      occurredAt: article.updatedAt,
    });

    expect(processor.process).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'knowledge.article_assigned_for_review',
        moduleKey: 'knowledge',
        recipients: [
          {
            userId: 'owner-a',
            interestReason: NotificationInterestReason.APPROVER,
          },
        ],
        payload: expect.objectContaining({
          actionUrl: '/knowledge/article-a',
          articleId: 'article-a',
        }),
      }),
    );
  });

  it('publishes comments to article stakeholders without notifying the comment author', async () => {
    const publisher = new KnowledgeNotificationPublisher(processor as never);

    await publisher.publishCommentAdded({
      article: article as never,
      comment: {
        id: 'comment-a',
        createdAt: new Date('2026-01-02T10:00:00.000Z'),
      } as never,
      actorUserId: 'author-a',
    });

    expect(processor.process).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId:
          'knowledge.comment_added:article-a:comment-a:2026-01-02T10:00:00.000Z',
        eventType: 'knowledge.comment_added',
        recipients: [
          {
            userId: 'owner-a',
            interestReason: NotificationInterestReason.WATCHING,
          },
        ],
        payload: expect.objectContaining({
          commentId: 'comment-a',
        }),
      }),
    );
  });
});
