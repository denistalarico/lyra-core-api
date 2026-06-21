import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import { CreateKnowledgeCommentDto, UpdateKnowledgeCommentDto } from '../dto';
import { KnowledgeCommentsService } from '../services';
import { KnowledgeContext } from '../services/knowledge-context';

function buildKnowledgeContext(
  headers: Record<string, string | string[] | undefined>,
): KnowledgeContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: String(headers['x-user-id'] ?? ''),
    role: String(headers['x-user-role'] ?? ''),
    userName: headers['x-user-name']
      ? String(headers['x-user-name'])
      : undefined,
  };
}

@Controller('agency/knowledge')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeCommentsController {
  constructor(private readonly commentsService: KnowledgeCommentsService) {}

  @Get('articles/:articleId/comments')
  @RequirePermission('agency.knowledge.articles.view.published')
  listByArticle(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('articleId') articleId: string,
  ) {
    return this.commentsService.listByArticle(
      buildKnowledgeContext(headers),
      articleId,
    );
  }

  @Post('articles/:articleId/comments')
  @RequirePermission('agency.knowledge.articles.comment')
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('articleId') articleId: string,
    @Body() dto: CreateKnowledgeCommentDto,
  ) {
    return this.commentsService.create(
      buildKnowledgeContext(headers),
      articleId,
      dto,
    );
  }

  @Patch('comments/:commentId')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('commentId') commentId: string,
    @Body() dto: UpdateKnowledgeCommentDto,
  ) {
    return this.commentsService.update(
      buildKnowledgeContext(headers),
      commentId,
      dto,
    );
  }
}
