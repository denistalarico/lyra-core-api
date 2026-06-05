import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateKnowledgeCommentDto, UpdateKnowledgeCommentDto } from '../dto';
import { AgencyKnowledgeComment } from '../entities';
import { KnowledgeContext } from './knowledge-context';

@Injectable()
export class KnowledgeCommentsService {
  constructor(
    @InjectRepository(AgencyKnowledgeComment, 'agency')
    private readonly commentsRepository: Repository<AgencyKnowledgeComment>,
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

  create(
    context: KnowledgeContext,
    articleId: string,
    dto: CreateKnowledgeCommentDto,
  ) {
    const comment = this.commentsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      articleId,
      authorId: context.userId,
      body: dto.body,
    });

    return this.commentsRepository.save(comment);
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
