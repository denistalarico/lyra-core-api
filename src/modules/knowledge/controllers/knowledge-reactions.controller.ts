import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import { AgencyKnowledgeReactionType } from '../enums';
import { KnowledgeReactionsService } from '../services';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

@Controller('agency/knowledge/articles/:articleId/reactions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeReactionsController {
  constructor(private readonly reactionsService: KnowledgeReactionsService) {}

  @Get()
  @RequirePermission('agency.knowledge.articles.view.published')
  listByArticle(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('articleId') articleId: string,
  ) {
    return this.reactionsService.listByArticle(context, articleId);
  }

  @Post(':type')
  @RequirePermission('agency.knowledge.articles.comment')
  setReaction(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('articleId') articleId: string,
    @Param('type') type: AgencyKnowledgeReactionType,
  ) {
    return this.reactionsService.setReaction(context, articleId, type);
  }

  @Delete(':type')
  @RequirePermission('agency.knowledge.articles.comment')
  removeReaction(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('articleId') articleId: string,
    @Param('type') type: AgencyKnowledgeReactionType,
  ) {
    return this.reactionsService.removeReaction(context, articleId, type);
  }
}
