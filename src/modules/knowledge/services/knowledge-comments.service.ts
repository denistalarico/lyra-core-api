import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateKnowledgeCommentDto, UpdateKnowledgeCommentDto } from '../dto';
import { AgencyKnowledgeArticle, AgencyKnowledgeComment } from '../entities';
import { KnowledgeContext } from './knowledge-context';
import { KnowledgeNotificationPublisher } from './knowledge-notification.publisher';

@Injectable()
export class KnowledgeCommentsService {
  constructor(
    @InjectRepository(AgencyKnowledgeComment, 'agency')
    private readonly commentsRepository: Repository<AgencyKnowledgeComment>,
    @InjectRepository(AgencyKnowledgeArticle, 'agency')
    private readonly articlesRepository: Repository<AgencyKnowledgeArticle>,
    private readonly knowledgeNotificationPublisher: KnowledgeNotificationPublisher,
  ) {}

  listByArticle(context: KnowledgeContext, articleId: string) {
    return this.commentsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        articleId,
      },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  async create(
    context: KnowledgeContext,
    articleId: string,
    dto: CreateKnowledgeCommentDto,
  ) {
    const article = await this.articlesRepository.findOne({
      where: {
        id: articleId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!article) {
      throw new NotFoundException('Knowledge article not found');
    }

    const comment = this.commentsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      articleId,
      authorId: context.userId,
      authorName: context.userName ?? null,
      body: dto.body,
    });

    const saved = await this.commentsRepository.save(comment);

    await this.knowledgeNotificationPublisher.publishCommentAdded({
      article,
      comment: saved,
      actorUserId: context.userId,
      occurredAt: saved.createdAt,
    });

    return saved;
  }

  async update(
    context: KnowledgeContext,
    commentId: string,
    dto: UpdateKnowledgeCommentDto,
  ) {
    const comment = await this.commentsRepository.findOne({
      where: {
        id: commentId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!comment) {
      throw new NotFoundException('Knowledge comment not found');
    }

    Object.assign(comment, {
      body: dto.body ?? comment.body,
      status: dto.status ?? comment.status,
    });

    return this.commentsRepository.save(comment);
  }
}
