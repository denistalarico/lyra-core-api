import {
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import { AgencyKnowledgeReactionType } from '../enums';
import { KnowledgeReactionsService } from '../services';
import { KnowledgeContext } from '../services/knowledge-context';

function buildKnowledgeContext(
  headers: Record<string, string | string[] | undefined>,
): KnowledgeContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: String(headers['x-user-id'] ?? ''),
    role: String(headers['x-user-role'] ?? ''),
  };
}

@Controller('agency/knowledge/articles/:articleId/reactions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeReactionsController {
  constructor(private readonly reactionsService: KnowledgeReactionsService) {}

  @Get()
  @RequirePermission('agency.knowledge.articles.view.published')
  listByArticle(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('articleId') articleId: string,
  ) {
    return this.reactionsService.listByArticle(
      buildKnowledgeContext(headers),
      articleId,
    );
  }

  @Post(':type')
  @RequirePermission('agency.knowledge.articles.comment')
  setReaction(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('articleId') articleId: string,
    @Param('type') type: AgencyKnowledgeReactionType,
  ) {
    return this.reactionsService.setReaction(
      buildKnowledgeContext(headers),
      articleId,
      type,
    );
  }

  @Delete(':type')
  @RequirePermission('agency.knowledge.articles.comment')
  removeReaction(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('articleId') articleId: string,
    @Param('type') type: AgencyKnowledgeReactionType,
  ) {
    return this.reactionsService.removeReaction(
      buildKnowledgeContext(headers),
      articleId,
      type,
    );
  }
}
