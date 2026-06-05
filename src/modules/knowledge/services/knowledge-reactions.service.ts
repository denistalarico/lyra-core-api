import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgencyKnowledgeReaction } from '../entities';
import { AgencyKnowledgeReactionType } from '../enums';
import { KnowledgeContext } from './knowledge-context';

@Injectable()
export class KnowledgeReactionsService {
  constructor(
    @InjectRepository(AgencyKnowledgeReaction, 'agency')
    private readonly reactionsRepository: Repository<AgencyKnowledgeReaction>,
  ) {}

  listByArticle(context: KnowledgeContext, articleId: string) {
    return this.reactionsRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        articleId,
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async setReaction(
    context: KnowledgeContext,
    articleId: string,
    type: AgencyKnowledgeReactionType,
  ) {
    const existing = await this.reactionsRepository.findOne({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        articleId,
        userId: context.userId,
        type,
      },
    });

    if (existing) {
      return existing;
    }

    const reaction = this.reactionsRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      articleId,
      userId: context.userId,
      type,
    });

    return this.reactionsRepository.save(reaction);
  }

  async removeReaction(
    context: KnowledgeContext,
    articleId: string,
    type: AgencyKnowledgeReactionType,
  ) {
    await this.reactionsRepository.delete({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      articleId,
      userId: context.userId,
      type,
    });

    return {
      removed: true,
      articleId,
      type,
    };
  }
}
