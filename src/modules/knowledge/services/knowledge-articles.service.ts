import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import {
  CreateKnowledgeArticleDto,
  ListKnowledgeArticlesQueryDto,
  UpdateKnowledgeArticleDto,
} from '../dto';
import { AgencyKnowledgeArticle } from '../entities';
import { AgencyKnowledgeArticleStatus } from '../enums';
import { parseOptionalDate, KnowledgeContext } from './knowledge-context';
import { FilesService } from '../../../common/files/files.service';
import { KnowledgeNotificationPublisher } from './knowledge-notification.publisher';

@Injectable()
export class KnowledgeArticlesService {
  constructor(
    @InjectRepository(AgencyKnowledgeArticle, 'agency')
    private readonly articlesRepository: Repository<AgencyKnowledgeArticle>,
    private readonly filesService: FilesService,
    private readonly knowledgeNotificationPublisher: KnowledgeNotificationPublisher,
  ) {}

  list(context: KnowledgeContext, query: ListKnowledgeArticlesQueryDto) {
    return this.articlesRepository.find({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.search ? { title: ILike(`%${query.search}%`) } : {}),
      },
      order: {
        isPinned: 'DESC',
        updatedAt: 'DESC',
      },
    });
  }

  async get(context: KnowledgeContext, id: string) {
    const article = await this.articlesRepository.findOne({
      where: {
        id,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });

    if (!article) {
      throw new NotFoundException('Knowledge article not found');
    }

    return article;
  }

  async create(context: KnowledgeContext, dto: CreateKnowledgeArticleDto) {
    const status = dto.status ?? AgencyKnowledgeArticleStatus.DRAFT;
    const article = this.articlesRepository.create({
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      authorId: context.userId,
      categoryId: dto.categoryId ?? null,
      ownerId: dto.ownerId ?? null,
      clientId: dto.clientId ?? null,
      projectId: dto.projectId ?? null,
      taskId: dto.taskId ?? null,
      title: dto.title,
      slug: dto.slug,
      summary: dto.summary ?? null,
      type: dto.type,
      status,
      visibility: dto.visibility,
      headerJson: dto.headerJson ?? {},
      contentJson: dto.contentJson ?? [],
      contentHtml: dto.contentHtml ?? null,
      footerJson: dto.footerJson ?? {},
      tags: dto.tags ?? [],
      isPinned: dto.isPinned ?? false,
      isFeatured: dto.isFeatured ?? false,
      isOnboardingRequired: dto.isOnboardingRequired ?? false,
      estimatedReadMinutes: dto.estimatedReadMinutes ?? 1,
      reviewAt: parseOptionalDate(dto.reviewAt),
      publishedAt:
        status === AgencyKnowledgeArticleStatus.PUBLISHED ? new Date() : null,
    });

    const saved = await this.articlesRepository.save(article);

    if (saved.ownerId) {
      await this.knowledgeNotificationPublisher.publishArticleAssigned({
        article: saved,
        actorUserId: context.userId,
        occurredAt: saved.createdAt,
      });
    }

    if (saved.status === AgencyKnowledgeArticleStatus.PUBLISHED) {
      await this.knowledgeNotificationPublisher.publishArticlePublished({
        article: saved,
        actorUserId: context.userId,
        occurredAt: saved.publishedAt ?? saved.createdAt,
      });
    }

    return saved;
  }

  async update(
    context: KnowledgeContext,
    id: string,
    dto: UpdateKnowledgeArticleDto,
  ) {
    const article = await this.get(context, id);
    const previousStatus = article.status;
    const previousOwnerId = article.ownerId;

    Object.assign(article, {
      categoryId:
        dto.categoryId === undefined ? article.categoryId : dto.categoryId,
      ownerId: dto.ownerId === undefined ? article.ownerId : dto.ownerId,
      clientId: dto.clientId === undefined ? article.clientId : dto.clientId,
      projectId:
        dto.projectId === undefined ? article.projectId : dto.projectId,
      taskId: dto.taskId === undefined ? article.taskId : dto.taskId,
      title: dto.title ?? article.title,
      slug: dto.slug ?? article.slug,
      summary: dto.summary === undefined ? article.summary : dto.summary,
      type: dto.type ?? article.type,
      status: dto.status ?? article.status,
      visibility: dto.visibility ?? article.visibility,
      headerJson: dto.headerJson ?? article.headerJson,
      contentJson: dto.contentJson ?? article.contentJson,
      contentHtml:
        dto.contentHtml === undefined ? article.contentHtml : dto.contentHtml,
      footerJson: dto.footerJson ?? article.footerJson,
      tags: dto.tags ?? article.tags,
      isPinned: dto.isPinned ?? article.isPinned,
      isFeatured: dto.isFeatured ?? article.isFeatured,
      isOnboardingRequired:
        dto.isOnboardingRequired ?? article.isOnboardingRequired,
      estimatedReadMinutes:
        dto.estimatedReadMinutes ?? article.estimatedReadMinutes,
      reviewAt:
        dto.reviewAt === undefined
          ? article.reviewAt
          : parseOptionalDate(dto.reviewAt),
    });

    if (
      previousStatus !== AgencyKnowledgeArticleStatus.PUBLISHED &&
      article.status === AgencyKnowledgeArticleStatus.PUBLISHED
    ) {
      article.publishedAt = new Date();
    }

    if (
      previousStatus !== AgencyKnowledgeArticleStatus.ARCHIVED &&
      article.status === AgencyKnowledgeArticleStatus.ARCHIVED
    ) {
      article.archivedAt = new Date();
    }

    const saved = await this.articlesRepository.save(article);

    if (saved.ownerId && saved.ownerId !== previousOwnerId) {
      await this.knowledgeNotificationPublisher.publishArticleAssigned({
        article: saved,
        actorUserId: context.userId,
        occurredAt: saved.updatedAt,
      });
    }

    if (
      previousStatus !== AgencyKnowledgeArticleStatus.PUBLISHED &&
      saved.status === AgencyKnowledgeArticleStatus.PUBLISHED
    ) {
      await this.knowledgeNotificationPublisher.publishArticlePublished({
        article: saved,
        actorUserId: context.userId,
        occurredAt: saved.publishedAt ?? saved.updatedAt,
      });
    }

    if (
      previousStatus !== AgencyKnowledgeArticleStatus.ARCHIVED &&
      saved.status === AgencyKnowledgeArticleStatus.ARCHIVED
    ) {
      await this.knowledgeNotificationPublisher.publishArticleArchived({
        article: saved,
        actorUserId: context.userId,
        occurredAt: saved.archivedAt ?? saved.updatedAt,
      });
    }

    return saved;
  }

  async remove(context: KnowledgeContext, id: string) {
    const article = await this.get(context, id);
    await this.articlesRepository.remove(article);
    return { deleted: true, id };
  }

  async uploadCover(context: KnowledgeContext, id: string, file: Express.Multer.File) {
    const article = await this.get(context, id);
    const stored = await this.filesService.uploadImageAsset({
      file,
      path: `tenants/${context.tenantId}/workspaces/${context.workspaceId}/knowledge/${id}/cover-${Date.now()}.webp`,
      maxDimension: 1600,
    });
    article.headerJson = { ...article.headerJson, coverUrl: stored.url };
    return this.articlesRepository.save(article);
  }
}
