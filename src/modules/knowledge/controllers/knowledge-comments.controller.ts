import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import { CreateKnowledgeCommentDto, UpdateKnowledgeCommentDto } from '../dto';
import { KnowledgeCommentsService } from '../services';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

@Controller('agency/knowledge')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeCommentsController {
  constructor(private readonly commentsService: KnowledgeCommentsService) {}

  @Get('articles/:articleId/comments')
  @RequirePermission('agency.knowledge.articles.view.published')
  listByArticle(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('articleId') articleId: string,
  ) {
    return this.commentsService.listByArticle(context, articleId);
  }

  @Post('articles/:articleId/comments')
  @RequirePermission('agency.knowledge.articles.comment')
  create(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('articleId') articleId: string,
    @Body() dto: CreateKnowledgeCommentDto,
  ) {
    return this.commentsService.create(context, articleId, dto);
  }

  @Patch('comments/:commentId')
  @RequirePermission('agency.knowledge.categories.manage.admin')
  update(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('commentId') commentId: string,
    @Body() dto: UpdateKnowledgeCommentDto,
  ) {
    return this.commentsService.update(context, commentId, dto);
  }
}
