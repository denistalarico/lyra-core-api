import {
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
} from "@nestjs/common";
import { AgencyKnowledgeReactionType } from "../enums";
import { KnowledgeReactionsService } from "../services";
import { KnowledgeContext } from "../services/knowledge-context";

function buildKnowledgeContext(headers: Record<string, string | string[] | undefined>): KnowledgeContext {
  return {
    tenantId: String(headers["x-tenant-id"] ?? ""),
    workspaceId: String(headers["x-workspace-id"] ?? ""),
    userId: String(headers["x-user-id"] ?? ""),
    role: String(headers["x-user-role"] ?? ""),
  };
}

@Controller("agency/knowledge/articles/:articleId/reactions")
export class KnowledgeReactionsController {
  constructor(
    private readonly reactionsService: KnowledgeReactionsService,
  ) {}

  @Get()
  listByArticle(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("articleId") articleId: string,
  ) {
    return this.reactionsService.listByArticle(
      buildKnowledgeContext(headers),
      articleId,
    );
  }

  @Post(":type")
  setReaction(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("articleId") articleId: string,
    @Param("type") type: AgencyKnowledgeReactionType,
  ) {
    return this.reactionsService.setReaction(
      buildKnowledgeContext(headers),
      articleId,
      type,
    );
  }

  @Delete(":type")
  removeReaction(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param("articleId") articleId: string,
    @Param("type") type: AgencyKnowledgeReactionType,
  ) {
    return this.reactionsService.removeReaction(
      buildKnowledgeContext(headers),
      articleId,
      type,
    );
  }
}
