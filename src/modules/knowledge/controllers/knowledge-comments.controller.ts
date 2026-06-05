import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  CreateKnowledgeCommentDto,
  UpdateKnowledgeCommentDto,
} from "../dto";
import { KnowledgeCommentsService } from "../services";
import { KnowledgeContext } from "../services/knowledge-context";

function buildKnowledgeContext(headers: Record<string, string | string[] | undefined>): KnowledgeContext {
  return {
    tenantId: String(headers["x-tenant-id"] ?? ""),
    workspaceId: String(headers["x-workspace-id"] ?? ""),
    userId: String(headers["x-user-id"] ?? ""),
    role: String(headers["x-user-role"] ?? ""),
  };
}

@Controller("agency/knowledge")
export class KnowledgeCommentsController {
  constructor(
    private readonly commentsService: KnowledgeCommentsService,
  ) {}

  @Get("articles/:articleId/comments")
  listByArticle(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("articleId") articleId: string,
  ) {
    return this.commentsService.listByArticle(
      buildKnowledgeContext(headers),
      articleId,
    );
  }

  @Post("articles/:articleId/comments")
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("articleId") articleId: string,
    @Body() dto: CreateKnowledgeCommentDto,
  ) {
    return this.commentsService.create(
      buildKnowledgeContext(headers),
      articleId,
      dto,
    );
  }

  @Patch("comments/:commentId")
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("commentId") commentId: string,
    @Body() dto: UpdateKnowledgeCommentDto,
  ) {
    return this.commentsService.update(
      buildKnowledgeContext(headers),
      commentId,
      dto,
    );
  }
}
